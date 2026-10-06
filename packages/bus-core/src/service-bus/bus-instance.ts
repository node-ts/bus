import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { serializeError } from 'serialize-error'
import throat from 'throat'
import { ContainerAdapter } from '../container'
import {
  ClassHandlerNotResolved,
  DelayedReplyNotSupported,
  FailMessageOutsideHandlingContext,
  ReplyOutsideHandlingContext,
  ReturnAddressMissing,
  ReturnMessageOutsideHandlingContext
} from '../error'
import {
  BusSender,
  FunctionHandler,
  Handler,
  HandlerContext,
  HandlerDefinition,
  HandlerDispatchRejected,
  HandlerRegistry,
  isClassHandler
} from '../handler'
import { Logger } from '../logger'
import { MessageHandlingContext } from '../message-handling-context'
import { MessageLifecycleContext } from '../message-lifecycle-context'
import {
  HandlerInvocationContext,
  IncomingContext,
  OutgoingContext,
  OutgoingMessageDropped,
  OutgoingMessageDropReason,
  OutgoingPublishContext,
  OutgoingReplyContext,
  OutgoingSendContext,
  RequestedSettlement
} from '../middleware'
import { MiddlewarePipeline } from '../middleware/middleware-pipeline'
import {
  OutboxNotEnabled,
  TransactionContext,
  TransactionRollbackReason,
  TransactionRolledBack
} from '../outbox'
import { BufferedWorkflowStateStore } from '../outbox/buffered-workflow-state-store'
import {
  isOutboxPersistence,
  OutboxPersistence
} from '../outbox/outbox-persistence'
import {
  UnitOfWorkContext,
  UnitOfWorkScope
} from '../outbox/unit-of-work-context'
import {
  DelayedDeliveryNotSupported,
  DelayedDeliveryOptions,
  DelayedDeliveryUnsupportedReason,
  OutgoingMessage,
  OutgoingMessageClaim,
  OutgoingMessageDestinationMissing,
  SendOptions
} from '../outgoing-message'
import { assertDeliveryOptions } from '../outgoing-message/assert-delivery-options'
import {
  DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
  isOutgoingMessageStore,
  OutgoingMessageDispatcher
} from '../outgoing-message/outgoing-message-dispatcher'
import { ProvisioningPlan, ProvisionOptions } from '../provisioning'
import {
  ReceivedMessageFailure,
  ReceivedMessageReturnedToQueue,
  Receiver
} from '../receiver'
import {
  createMessageFailure,
  deadLetter,
  FailMessageRequested,
  FAILURE_HEADER,
  isRecoverabilityAction,
  RecoverabilityAction,
  RecoverabilityPolicy,
  ReturnMessageRequested
} from '../recoverability'
import { MessageTypesMissing } from '../serialization'
import {
  Transport,
  TransportHeaderReserved,
  TransportMessage,
  TransportReplyNotSupported
} from '../transport'
import { ClassConstructor, CoreDependencies, sleep } from '../util'
import {
  Persistence,
  PersistenceNotConfigured,
  PersistenceTransaction
} from '../workflow/persistence'
import { WorkflowRegistry } from '../workflow/registry'
import { WorkflowState } from '../workflow/workflow-state'
import { BusState } from './bus-state'
import { InvalidBusState, InvalidOperation } from './error'

/**
 * The least time between two reads of an application loop that both come back empty, so a transport that returns
 * straight away when it has no messages doesn't spin
 */
const EMPTY_QUEUE_SLEEP_MS = 500

/**
 * Whether the class of a message type is a workflow state, which is stored rather than sent. A class that extends
 * the `WorkflowState` of another copy of @node-ts/bus-core isn't an `instanceof` this one, so the names of its base
 * classes are checked too.
 */
const isWorkflowStateClass = (
  messageTypeClass: (new (...args: any[]) => object) | undefined
): boolean => {
  if (!messageTypeClass) {
    return false
  }
  if (messageTypeClass.prototype instanceof WorkflowState) {
    return true
  }
  for (
    let base: unknown = Object.getPrototypeOf(messageTypeClass);
    typeof base === 'function';
    base = Object.getPrototypeOf(base)
  ) {
    if ((base as { name?: string }).name === WorkflowState.name) {
      return true
    }
  }
  return false
}

/**
 * How many buses use each persistence instance, so a persistence shared by several buses is only disposed by the
 * last of them. This holds no message or workflow state, and drops persistences that are garbage collected.
 */
const PERSISTENCE_USERS = new WeakMap<Persistence, number>()

interface InterruptSignalListener {
  signal: NodeJS.Signals
  listener: () => void
}

enum OutboxState {
  /**
   * The handlers are running, so outgoing messages are buffered
   */
  Open = 'open',
  /**
   * The handlers resolved and their buffered messages were dispatched
   */
  Flushed = 'flushed',
  /**
   * A handler failed and the buffered messages were dropped
   */
  Discarded = 'discarded'
}

/**
 * How a received message was settled on the transport once handling finished
 */
type Settlement =
  | { outcome: 'handled' | 'deadLettered' }
  | {
      outcome: 'retried'
      /**
       * Reported to a receiver host, so it doesn't delete the message
       */
      error: unknown
    }

/**
 * A message buffered in a handler's outbox, as the outgoing middleware left it, with what settles its `dispatched`
 * promise, the async context it was sent in, and when it's due if it's sent later
 */
type OutboxedMessage = OutgoingContext & {
  settle: PromiseWithResolvers<void>
  runInSendContext: <T>(fn: () => T) => T
  dueAt?: Date
  /**
   * The handler call or workflow instance that sent it, if one did
   */
  sentBy?: UnitOfWorkScope
}

/**
 * An outgoing message that's stored in the persistence until it's due
 */
type DelayedMessage = Exclude<OutboxedMessage, { kind: 'reply' }> & {
  dueAt: Date
}

// Replies are never delayed, since reply() rejects deliverAfter and deliverAt
const isDelayed = (
  outgoingMessage: OutboxedMessage
): outgoingMessage is DelayedMessage =>
  outgoingMessage.dueAt !== undefined && outgoingMessage.kind !== 'reply'

/**
 * An outgoing context before the bus adds its `dispatched` promise, which is also what the transport is called with
 */
type OutgoingDraft =
  | Omit<OutgoingSendContext, 'dispatched'>
  | Omit<OutgoingPublishContext, 'dispatched'>
  | Omit<OutgoingReplyContext, 'dispatched'>

/**
 * Buffers the messages sent while a received message is handled, which all of its handlers share, or while the work
 * of a `transaction()` runs
 */
interface Outbox {
  state: OutboxState
  messages: OutboxedMessage[]
  /**
   * Why the outbox was discarded, which a message sent after that is dropped for too
   */
  discardReason?: OutgoingMessageDropReason
  /**
   * The persistence transaction the outbox is stored in and committed with, on a bus configured with `withOutbox()`
   */
  transaction: PersistenceTransaction | undefined
  /**
   * Whether the transaction has been committed or rolled back
   */
  transactionEnded: boolean
  /**
   * The workflow state the handlers saved, held until the outbox is flushed, on a bus without `withOutbox()`
   */
  workflowStateSaves: BufferedWorkflowStateStore<UnitOfWorkScope> | undefined
  /**
   * What work given to `transaction()` threw while it was joined to the outbox's transaction, which can then only be
   * rolled back
   */
  joinedWorkError: { error: unknown } | undefined
}

/**
 * Drops what an outbox holds: its messages, rejecting their `dispatched` promises, and the workflow state saves it
 * holds without `withOutbox()`. Later sends into it are dropped too, for the same reason.
 */
const discardOutbox = (
  outbox: Outbox,
  reason: OutgoingMessageDropReason,
  cause?: unknown
): void => {
  outbox.state = OutboxState.Discarded
  outbox.discardReason = reason
  outbox.messages.forEach(m => dropOutgoing(m, reason, cause))
  outbox.messages = []
  outbox.workflowStateSaves?.discard()
}

/**
 * An outgoing message that's been committed to the store in an outbox's transaction, and the message as it was
 * buffered
 */
interface CommittedMessage {
  outboxedMessage: OutboxedMessage
  outgoingMessage: OutgoingMessage
}

/**
 * How many messages an outbox sends to the transport at once
 */
const OUTBOX_SEND_CONCURRENCY = 10

/**
 * Names a handler for `HandlerInvocationContext.handlerName`. Class handlers and named functions have their own
 * name, and the workflow registry names the handlers it registers after their workflow.
 */
const handlerNameOf = (handler: HandlerDefinition): string =>
  handler.name || 'anonymous'

/**
 * Copies an outgoing message as the outgoing middleware left it when it called `next()`, so changes a middleware
 * makes after `next()` never reach the transport, whether the message is sent straight away or buffered
 */
const snapshotOutgoing = (
  context: OutgoingContext,
  settle: OutboxedMessage['settle']
): OutboxedMessage => ({
  ...context,
  settle,
  runInSendContext: AsyncLocalStorage.snapshot(),
  attributes: {
    ...context.attributes,
    attributes: { ...context.attributes.attributes },
    stickyAttributes: { ...context.attributes.stickyAttributes }
  },
  headers: { ...context.headers }
})

/**
 * Creates `requestedSettlement()` for one message, reading its own lifecycle context however late it's called
 * @param readLifecycle reads the lifecycle context of that message
 */
const requestedSettlementOf =
  (
    readLifecycle: () =>
      { messageFailed: boolean; messageReturnedToQueue: boolean } | undefined
  ) =>
  (): RequestedSettlement | undefined => {
    const lifecycle = readLifecycle()
    if (lifecycle?.messageFailed) {
      return RequestedSettlement.Failed
    }
    return lifecycle?.messageReturnedToQueue
      ? RequestedSettlement.Returned
      : undefined
  }

/**
 * Resolves the `dispatched` promises of messages once `handOff` has sent or stored them, or rejects them with its
 * error, which is rethrown
 */
const settleDispatched = async (
  outgoingMessages: Pick<OutboxedMessage, 'settle'>[],
  handOff: Promise<void>
): Promise<void> => {
  try {
    await handOff
  } catch (error) {
    outgoingMessages.forEach(m => m.settle.reject(error))
    throw error
  }
  outgoingMessages.forEach(m => m.settle.resolve())
}

/**
 * Splits messages to store into the first with each `messageId` and the later copies, which a store would skip
 * @returns the messages to store, and the copies to drop as duplicates
 */
const splitRepeatedIds = <TMessage extends OutboxedMessage>(
  outgoingMessages: TMessage[]
): { unique: TMessage[]; repeated: TMessage[] } => {
  const seen = new Set<string>()
  const unique: TMessage[] = []
  const repeated: TMessage[] = []
  outgoingMessages.forEach(m => {
    const id = m.attributes.messageId
    if (id !== undefined && seen.has(id)) {
      repeated.push(m)
    } else {
      if (id !== undefined) {
        seen.add(id)
      }
      unique.push(m)
    }
  })
  return { unique, repeated }
}

/**
 * Rejects the `dispatched` promise of a message that won't be sent
 */
const dropOutgoing = (
  outgoingMessage: Pick<OutboxedMessage, 'message' | 'settle'>,
  reason: OutgoingMessageDropReason,
  cause?: unknown
): void =>
  outgoingMessage.settle.reject(
    new OutgoingMessageDropped(outgoingMessage.message.$name, reason, cause)
  )

/**
 * A bus built by `Bus.configure().build()`. It sends and publishes messages, and unless it's send-only, receives
 * them and dispatches them to handlers.
 */
export class BusInstance<TTransportMessage = {}> implements BusSender {
  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private logger: Logger
  private isInitialized = false
  private stopInProgress: Promise<void> | undefined
  private interruptSignalListeners: InterruptSignalListener[] = []
  private readonly outbox = new AsyncLocalStorage<Outbox>()
  private readonly outgoingMessageDispatcher:
    OutgoingMessageDispatcher | undefined
  private hasWarnedOfNonDurableDelivery = false
  /**
   * Registers the workflows' handlers, started by the first `provision()` or `initialize()`
   */
  private workflowRegistration: Promise<void> | undefined
  private isTransportConnected = false
  private hasReleasedPersistence = false
  /**
   * The messages this bus is handling right now, so a reply is only sent while its request is being handled
   */
  private readonly messagesBeingHandled = new Set<TransportMessage<unknown>>()
  /**
   * The persistence, when the bus is configured with `withOutbox()`
   */
  private readonly outboxPersistence: OutboxPersistence | undefined

  constructor(
    private readonly transport: Transport<TTransportMessage>,
    private readonly concurrency: number,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly coreDependencies: CoreDependencies,
    private readonly middlewarePipeline: MiddlewarePipeline,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly container: ContainerAdapter | undefined,
    private readonly sendOnly: boolean,
    private readonly receiver: Receiver | undefined,
    private readonly messageHandlingContext: MessageHandlingContext,
    private readonly messageLifecycleContext: MessageLifecycleContext,
    private readonly recoverability: RecoverabilityPolicy,
    private readonly persistence: Persistence,
    private readonly delayedDelivery: Required<DelayedDeliveryOptions>,
    private readonly scheduler: boolean,
    outbox: boolean,
    private readonly unitOfWorkContext: UnitOfWorkContext,
    private readonly provisioning: {
      autoProvision: boolean
      verifyResources: boolean
    } = { autoProvision: false, verifyResources: true }
  ) {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:service-bus'
    )
    // build() has checked the persistence supports the outbox
    this.outboxPersistence =
      outbox && isOutboxPersistence(persistence) ? persistence : undefined
    PERSISTENCE_USERS.set(
      persistence,
      (PERSISTENCE_USERS.get(persistence) ?? 0) + 1
    )
    if (isOutgoingMessageStore(persistence) && delayedDelivery.dispatch) {
      this.outgoingMessageDispatcher = new OutgoingMessageDispatcher(
        persistence,
        async outgoingMessage => this.sendStoredMessage(outgoingMessage),
        coreDependencies.loggerFactory(
          '@node-ts/bus-core:outgoing-message-dispatcher'
        )
      )
    }
  }

  /**
   * Receive one or more messages to dispatch directly to handlers. This can only be called when a Receiver
   * has been configured using Bus.configure().withReceiver()
   *
   * A message that fails is settled by the recoverability policy, as when the bus polls the transport. When it's
   * retried, it's returned to the transport with the policy's delay (on SQS, its visibility is changed) and reported
   * to the host as failed. When it's dead-lettered, it's moved to the dead letter queue with `transport.fail()` and
   * reported as handled, so the host deletes it from the source queue.
   * @param message The message, or batch of messages, received by the host (e.g. a Lambda event)
   * @returns Nothing, unless the receiver implements `toReceiveResult`, in which case its result is returned
   * @throws InvalidOperation if no Receiver has been configured
   * @throws the handling error of a message that's being retried, unless the receiver implements `toReceiveResult`
   * @throws ReceivedMessageReturnedToQueue if a handler called `returnMessage()` and the message is being retried,
   * unless the receiver implements `toReceiveResult`, which then gets it as a failure
   * @throws the transport's error if a message couldn't be dead-lettered, so the host retries it
   * @example
   * // Receiver that reports partial batch failures
   * const response = await bus.receive<SQSBatchResponse>(event)
   */
  async receive<TReceiveResult = void>(
    message: unknown
  ): Promise<TReceiveResult> {
    if (!this.receiver) {
      throw new InvalidOperation(
        'Cannot use handler when a Receiver is not set. Use Bus.configure().withReceiver() to set a Receiver.'
      )
    }
    this.logger.info('Received messages to process')
    const messagesReceived = await this.receiver.receive(
      message,
      this.coreDependencies.messageSerializer
    )
    const messagesToDispatch = (
      Array.isArray(messagesReceived) ? messagesReceived : [messagesReceived]
    ) as TransportMessage<TTransportMessage>[]

    this.logger.debug('Parsed messages from receiver', {
      numMessages: messagesToDispatch.length
    })

    // Throttle back to concurrency, since batch sizes can be far beyond this limit.
    const throttle = throat(this.concurrency)
    const handleMessage = (message: TransportMessage<TTransportMessage>) =>
      throttle(() => this.handleReceivedMessage(message))

    if (!this.receiver.toReceiveResult) {
      await Promise.all(messagesToDispatch.map(handleMessage))
      this.logger.debug('All received messages dispatched to handlers')
      return undefined as TReceiveResult
    }

    const results = await Promise.allSettled(
      messagesToDispatch.map(handleMessage)
    )
    const failures: ReceivedMessageFailure[] = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failures.push({
          message: messagesToDispatch[index],
          error: result.reason as Error
        })
      }
    })

    this.logger.debug('All received messages dispatched to handlers', {
      numFailed: failures.length
    })
    return (await this.receiver.toReceiveResult(failures)) as TReceiveResult
  }

  /**
   * Initializes the bus with the provided configuration. This must be called before `.start()`
   *
   * It connects the transport and persistence, and checks that the queues, topics, subscriptions, tables and
   * indexes the bus needs exist, without creating anything. Provision them first with `bus provision` from
   * @node-ts/bus-cli or `bus.provision()`, or configure the bus with `withAutoProvision()` to provision them here.
   * @throws InvalidOperation if the bus has already been initialized
   * @throws MessageTypesMissing if the bus receives messages, but a handled message or a workflow state has no
   * entry in the message types passed to `withMessageTypes()`
   * @throws ResourcesNotProvisioned if something the bus needs doesn't exist, unless it's configured with
   * `withAutoProvision()` or `withResourceVerification(false)`
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing bus')

    if (this.isInitialized) {
      throw new InvalidOperation('Bus has already been initialized')
    }

    await this.registerWorkflows()
    if (!this.sendOnly) {
      this.assertMessageTypesConfigured()
    }
    if (this.scheduler && !this.outgoingMessageDispatcher) {
      throw new DelayedDeliveryNotSupported(this.persistence.constructor.name)
    }

    const { autoProvision } = this.provisioning
    if (autoProvision) {
      await this.provision()
    }
    // There's no need to check what's just been provisioned
    const verifyResources = this.provisioning.verifyResources && !autoProvision

    if (this.usesPersistence() && this.persistence.initialize) {
      this.logger.info('Initializing persistence...')
      await this.persistence.initialize({
        workflows: this.workflowRegistry.getPersistedWorkflows(),
        verifyResources
      })
    }

    await this.connectTransport()
    if (this.transport.initialize) {
      // A scheduler only sends, so its transport doesn't set up a queue to receive from
      await this.transport.initialize({
        handlerRegistry: this.handlerRegistry,
        sendOnly: this.sendOnly || this.scheduler,
        messageNames: this.getMessageNames(),
        verifyResources,
        autoProvision
      })
    }

    this.warnIfOutboxIsNeverDispatched()
    this.subscribeToInterruptSignals(this.coreDependencies.interruptSignals)
    this.isInitialized = true
    this.logger.debug('Bus initialized', {
      sendOnly: this.sendOnly,
      registeredMessages: this.handlerRegistry.getMessageNames()
    })
  }

  /**
   * Creates everything the bus needs on its transport and persistence, such as its queue, dead letter queue, a
   * topic or exchange for each message, its subscriptions, tables and indexes. It's worked out from the bus'
   * handlers, workflows, custom handlers and message types, and is idempotent, so it can run on every deploy.
   *
   * Run it with deploy credentials, usually through `bus provision` from @node-ts/bus-cli, so the service itself
   * runs without permission to create anything. It doesn't initialize or start the bus, so call `dispose()` when
   * it's done.
   * @param options with `dryRun`, only works out the plan, without connecting to anything or changing anything
   * @returns what each transport or persistence that provisions anything provisions, and the permissions it needs
   * at runtime
   * @throws the transport's or persistence's own error if it can't create something, such as when a permission
   * is missing
   * @example
   * const bus = Bus.configure().withTransport(transport).withHandler(orderPlacedHandler).build()
   * try {
   *   await bus.provision()
   * } finally {
   *   await bus.dispose()
   * }
   */
  async provision(options: ProvisionOptions = {}): Promise<ProvisioningPlan[]> {
    const dryRun = options.dryRun ?? false
    this.logger.info(
      dryRun ? 'Planning provisioning' : 'Provisioning resources...'
    )
    await this.registerWorkflows()

    const plans: ProvisioningPlan[] = []
    if (this.usesPersistence() && this.persistence.provision) {
      plans.push(
        await this.persistence.provision({
          workflows: this.workflowRegistry.getPersistedWorkflows(),
          dryRun
        })
      )
    }
    if (this.transport.provision) {
      const messageNames = this.getMessageNames()
      if (this.sendOnly && messageNames.length === 0) {
        this.logger.warn(
          'The send-only bus has no message types, so no topic or exchange is provisioned for what it sends, and its runtime permissions allow sending nothing. Pass the message types it sends to withMessageTypes().'
        )
      }
      if (!dryRun) {
        await this.connectTransport()
      }
      plans.push(
        await this.transport.provision({
          handlerRegistry: this.handlerRegistry,
          sendOnly: this.sendOnly || this.scheduler,
          messageNames,
          // A scheduler sends the stored messages of every service that shares its persistence
          sendsAnyMessage: this.scheduler,
          dryRun
        })
      )
    }

    this.logger.info(
      dryRun ? 'Provisioning planned' : 'Resources provisioned',
      {
        resources: plans.reduce(
          (count, plan) => count + plan.resources.length,
          0
        )
      }
    )
    return plans
  }

  /**
   * Registers the handlers of the bus' workflows, once, so provisioning and initializing know every message the
   * bus handles and every workflow state it stores. A send-only bus has no workflows. Registering is only tried
   * once: if it failed, calling this again rejects with the same error rather than skipping it.
   */
  private async registerWorkflows(): Promise<void> {
    if (this.sendOnly) {
      return
    }
    this.workflowRegistration ??= this.workflowRegistry.initialize(
      this.handlerRegistry,
      this.container
    )
    await this.workflowRegistration
  }

  /**
   * Whether the bus stores anything in its persistence: workflow state, or messages sent later
   */
  private usesPersistence(): boolean {
    return (
      this.workflowRegistry.getPersistedWorkflows().length > 0 ||
      isOutgoingMessageStore(this.persistence)
    )
  }

  /**
   * Connects the transport, once, whether the bus is provisioning or initializing first
   */
  private async connectTransport(): Promise<void> {
    if (this.isTransportConnected) {
      return
    }
    this.isTransportConnected = true
    if (this.transport.connect) {
      await this.transport.connect({
        concurrency: this.concurrency
      })
    }
  }

  /**
   * Gets the `$name` of every message the bus handles or has message types for, leaving out workflow state, which
   * is never sent
   */
  private getMessageNames(): string[] {
    const { messageTypes } = this.coreDependencies
    const workflowStateNames = new Set(
      this.workflowRegistry.getWorkflowStateNames()
    )
    const typedMessageNames = Object.entries(messageTypes.messages)
      .filter(
        ([name, typeKey]) =>
          !workflowStateNames.has(name) &&
          !isWorkflowStateClass(messageTypes.types[typeKey]?.class)
      )
      .map(([name]) => name)
    return [
      ...new Set([
        ...this.handlerRegistry.getMessageNames(),
        ...typedMessageNames
      ])
    ]
  }

  /**
   * Publishes an event to the transport.
   *
   * The outgoing middleware runs first. Then, when called from inside a handler, the event is buffered and only
   * published once every handler of the message resolves, and is dropped if any of them fails. With `withOutbox()`,
   * it's stored in the message's transaction and published once that's committed. Anywhere else (outside a handler,
   * in incoming middleware, or after the handlers have already resolved) it's published straight away.
   *
   * With `deliverAfter` or `deliverAt`, the event is stored in the persistence instead of being published, and a
   * started bus that uses the same persistence publishes it once it's due. Inside a handler it's only stored once
   * the handlers resolve.
   * @param event An event to publish
   * @param options A set of attributes to attach to the outgoing message when published, and when to publish it. A
   * new `messageId` and `sentAt` are set unless given, and so is this bus' return address (`replyTo`) unless it's
   * send-only or a scheduler. Pass `replyTo: undefined` to leave the return address out.
   * @throws DelayedDeliveryNotSupported if `deliverAfter` or `deliverAt` is given and the persistence can't store
   * messages to send later
   * @throws InvalidDeliveryOptions if `deliverAfter` or `deliverAt` isn't a usable time, or both are given
   * @throws the error of an outgoing middleware that throws, in which case nothing is buffered
   * @example
   * await bus.publish(new TrialEnded(accountId), { deliverAt: trialEndsAt })
   */
  async publish<TEvent extends Event>(
    event: TEvent,
    options: SendOptions = {}
  ): Promise<void> {
    this.logger.debug('Publishing event', { event, options })
    const dueAt = this.resolveDueAt(event, options)
    await this.dispatchOutgoing(
      {
        kind: 'publish',
        message: event,
        attributes: this.prepareTransportOptions(options),
        headers: {}
      },
      dueAt
    )
  }

  /**
   * Sends a command to the transport.
   *
   * The outgoing middleware runs first. Then, when called from inside a handler, the command is buffered and only
   * sent once every handler of the message resolves, and is dropped if any of them fails. With `withOutbox()`, it's
   * stored in the message's transaction and sent once that's committed. Anywhere else (outside a handler, in
   * incoming middleware, or after the handlers have already resolved) it's sent straight away.
   *
   * With `deliverAfter` or `deliverAt`, the command is stored in the persistence instead of being sent, and a
   * started bus that uses the same persistence sends it once it's due. Inside a handler it's only stored once the
   * handlers resolve.
   * @param command A command to send
   * @param options A set of attributes to attach to the outgoing message when sent, and when to send it. A new
   * `messageId` and `sentAt` are set unless given, and so is this bus' return address (`replyTo`) unless it's
   * send-only or a scheduler. Pass `replyTo: undefined` to leave the return address out.
   * @throws DelayedDeliveryNotSupported if `deliverAfter` or `deliverAt` is given and the persistence can't store
   * messages to send later
   * @throws InvalidDeliveryOptions if `deliverAfter` or `deliverAt` isn't a usable time, or both are given
   * @throws the error of an outgoing middleware that throws, in which case nothing is buffered
   * @example
   * await bus.send(new ChargeCard(orderId), { deliverAfter: 30_000 })
   */
  async send<TCommand extends Command>(
    command: TCommand,
    options: SendOptions = {}
  ): Promise<void> {
    this.logger.debug('Sending command', { command, options })
    const dueAt = this.resolveDueAt(command, options)
    await this.dispatchOutgoing(
      {
        kind: 'send',
        message: command,
        attributes: this.prepareTransportOptions(options),
        headers: {}
      },
      dueAt
    )
  }

  /**
   * Instructs the bus that the message being handled can never succeed, so once handling finishes it's moved to the
   * dead letter queue with its failure metadata instead of being deleted or retried, even if a handler then throws.
   * The recoverability policy isn't consulted. Code after the call keeps running, but the messages the handler sends
   * are dropped and a workflow handler's state changes aren't saved, as when a handler throws.
   * @throws FailMessageOutsideHandlingContext if called outside a message handling context of this bus, including
   * while another bus is handling a message
   */
  async failMessage(): Promise<void> {
    const context = this.messageLifecycleContext.get()
    const message = this.messageHandlingContext.get()
    if (!context || !message) {
      throw new FailMessageOutsideHandlingContext()
    }
    this.messageLifecycleContext.set({ ...context, messageFailed: true })
    this.logger.debug(
      'Message will be moved to the dead letter queue once handled',
      { message }
    )
  }

  /**
   * Instructs that the message being handled should be returned to the queue for retry once handling finishes,
   * without failing the handler. It counts as a failed attempt: the recoverability policy decides the delay, and
   * dead-letters the message once it's out of attempts. The messages the handler sends are dropped and a workflow
   * handler's state changes aren't saved, since the message will be handled again. When the message came from a
   * Receiver, it's also reported to the receiver host as failed so the host doesn't delete it.
   * @throws ReturnMessageOutsideHandlingContext if called outside a message handling context of this bus,
   * including while another bus is handling a message
   */
  async returnMessage(): Promise<void> {
    const context = this.messageLifecycleContext.get()
    const message = this.messageHandlingContext.get()
    if (!context || !message) {
      throw new ReturnMessageOutsideHandlingContext()
    }
    this.messageLifecycleContext.set({
      ...context,
      messageReturnedToQueue: true
    })
    this.logger.debug('Message will be returned to the queue once handled', {
      message
    })
  }

  /**
   * Runs work in a transaction of the bus' persistence, such as when an HTTP API saves an order and publishes
   * `OrderPlaced`. The messages it sends and publishes through its context are stored in the transaction and only sent
   * once it's committed, so they're sent if, and only if, the work's changes are kept. To save your own data in the
   * same transaction, read it from the context with the persistence's accessor, such as `postgresTransaction(ctx)`.
   *
   * Called from inside a handler, or from the work of another `transaction()`, the work joins the transaction that's
   * already running, and is committed or rolled back with it. If the work throws, that transaction is rolled back
   * even if the error is caught, and the message being handled fails with `TransactionRolledBack`.
   *
   * Once the transaction is committed, a message that fails to send stays in the persistence, and a started bus that
   * uses it sends it, so the call still resolves.
   * @param work what to run in the transaction, given a context to send and publish from
   * @returns what the work returns, once the transaction is committed
   * @throws OutboxNotEnabled if the bus wasn't configured with `withOutbox()`
   * @throws InvalidOperation if the bus hasn't been initialized
   * @throws the error the work throws, once the transaction has been rolled back
   * @throws the persistence's error if the transaction can't be begun or committed, in which case nothing was kept
   * or sent
   * @example
   * app.post('/orders', async (request, response) => {
   *   await bus.transaction(async ctx => {
   *     await postgresTransaction(ctx).query('insert into orders (id) values ($1)', [request.body.orderId])
   *     await ctx.publish(new OrderPlaced(request.body.orderId))
   *   })
   *   response.sendStatus(201)
   * })
   */
  async transaction<TResult>(
    work: (context: TransactionContext) => Promise<TResult>
  ): Promise<TResult> {
    if (!this.outboxPersistence) {
      throw new OutboxNotEnabled()
    }
    if (!this.isInitialized) {
      throw new InvalidOperation(
        'Bus must be initialized before running a transaction'
      )
    }
    const outbox = this.outbox.getStore()
    if (outbox?.transaction && outbox.state === OutboxState.Open) {
      try {
        return await work(this.createTransactionContext(outbox.transaction))
      } catch (error) {
        // The work is part of the transaction it joined, so that can't be committed without it, even if the error
        // is caught
        outbox.joinedWorkError ??= { error }
        throw error
      }
    }
    return this.runInOutbox(undefined, async ({ transaction }) =>
      work(this.createTransactionContext(transaction))
    )
  }

  /**
   * Gets the message this bus is handling in the current async stack, such as from middleware or code called by a
   * handler. Handlers get the same details from their handler context.
   * @returns the transport message being handled, or `undefined` outside a message handling context of this bus,
   * including while another bus is handling a message
   */
  getHandlingContext(): TransportMessage<unknown> | undefined {
    return this.messageHandlingContext.get()
  }

  /**
   * Instructs the bus to start reading messages from the underlying service queue
   * and dispatching to message handlers. It also starts sending the messages in its persistence that were sent with
   * `deliverAfter` or `deliverAt`, by this bus or any other that uses the same persistence, once they're due.
   *
   * @throws InvalidOperation if the bus is configured to be send-only
   * @throws InvalidOperation if the bus has not been initialized
   * @throws InvalidOperation if the bus has a receiver set
   * @throws InvalidBusState if the bus is already started or in a starting state
   */
  async start(): Promise<void> {
    if (this.sendOnly) {
      throw new InvalidOperation('Cannot start a send-only bus')
    }
    if (!this.isInitialized) {
      throw new InvalidOperation('Bus must be initialized before starting')
    }
    if (this.receiver) {
      throw new InvalidOperation(
        'Cannot start a bus with a Receiver. Pass incoming messages for dispatch by invoking bus.receive()'
      )
    }
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new InvalidBusState(
        'Bus must be stopped before it can be started',
        this.state,
        [BusState.Stopped, BusState.Stopping]
      )
    }
    this.internalState = BusState.Starting
    this.logger.info('Bus starting...')

    if (this.scheduler) {
      // A scheduler doesn't read from a queue, and only sends scheduled messages
      this.internalState = BusState.Started
      this.outgoingMessageDispatcher?.start()
      this.logger.info('Scheduler started, sending scheduled messages')
      return
    }

    if (this.transport.start) {
      await this.transport.start()
    }

    if (this.internalState !== BusState.Starting) {
      // stop() was called while the transport was starting, so don't spin up workers
      this.logger.info('Bus was stopped before it finished starting')
      return
    }

    this.internalState = BusState.Started
    for (let i = 0; i < this.concurrency; i++) {
      // Count the worker before it's scheduled so a stop() straight after start() waits for it
      this.runningWorkerCount++
      setTimeout(() => {
        // The loop handles its own errors, so this only catches a bug in the loop itself
        this.applicationLoop().catch(error =>
          this.logger.error('Application loop exited unexpectedly', {
            error: serializeError(error)
          })
        )
      }, 0)
    }

    this.outgoingMessageDispatcher?.start()

    this.logger.info(`Bus started with concurrency ${this.concurrency}`)
  }

  /**
   * Stops a bus that has been started by `.start()`. This will wait for all running workers to complete
   * their current message handling contexts before returning.
   *
   * @throws InvalidBusState if the bus is already stopped or stopping
   */
  async stop(): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new InvalidBusState(
        'Bus must be started before it can be stopped',
        this.state,
        [BusState.Started, BusState.Starting]
      )
    }
    this.internalState = BusState.Stopping
    this.logger.info('Bus stopping...')

    this.stopInProgress = this.stopTransportAndWorkers()
    try {
      await this.stopInProgress
    } finally {
      this.stopInProgress = undefined
    }
  }

  /**
   * Stops and disposes all resources allocated to the bus, as well as removing
   * all handler registrations.
   *
   * The bus instance can not be used after this has been called. If the bus is
   * already stopping, this waits for that stop to complete rather than stopping again.
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing bus instance...')
    this.unsubscribeFromInterruptSignals()
    if (this.stopInProgress) {
      await this.stopInProgress
    } else if ([BusState.Started, BusState.Starting].includes(this.state)) {
      await this.stop()
    }
    if (this.transport.disconnect) {
      await this.transport.disconnect()
    }
    if (this.transport.dispose) {
      await this.transport.dispose()
    }
    await this.disposePersistence()
    this.coreDependencies.handlerRegistry.reset()
    this.logger.info('Bus instance disposed')
  }

  /**
   * Disposes the persistence, unless another bus still uses it
   */
  private async disposePersistence(): Promise<void> {
    // Disposing a bus twice mustn't count it twice, or a persistence another bus uses would be disposed
    if (this.hasReleasedPersistence) {
      return
    }
    this.hasReleasedPersistence = true
    const remainingUsers = (PERSISTENCE_USERS.get(this.persistence) ?? 1) - 1
    PERSISTENCE_USERS.set(this.persistence, remainingUsers)
    if (remainingUsers > 0) {
      this.logger.debug(
        'Persistence is still used by another bus, so it will not be disposed',
        { remainingUsers }
      )
      return
    }
    try {
      if (this.persistence.dispose) {
        await this.persistence.dispose()
      }
    } catch (error) {
      if (error instanceof PersistenceNotConfigured) {
        return
      }
      throw error
    }
  }

  /**
   * Gets the current state of a message-handling bus
   */
  get state(): BusState {
    return this.internalState
  }

  /**
   * The return address stamped on outgoing messages, so replies come back to this bus' queue: the transport's
   * `returnAddress`, or its `endpointName` when it has none. `undefined` for a send-only bus, a scheduler or a
   * transport with neither, which have no queue that's read.
   */
  private get returnAddress(): string | undefined {
    if (this.sendOnly || this.scheduler) {
      return undefined
    }
    return (
      this.transport.returnAddress || this.transport.endpointName || undefined
    )
  }

  private async stopTransportAndWorkers(): Promise<void> {
    await this.outgoingMessageDispatcher?.stop()
    if (!this.scheduler && this.transport.stop) {
      await this.transport.stop()
    }

    while (this.runningWorkerCount > 0) {
      await sleep(10)
    }

    this.internalState = BusState.Stopped
    this.logger.info('Bus stopped')
  }

  /**
   * Runs a single worker. `runningWorkerCount` is incremented by `start()` when the worker is
   * scheduled, and decremented here once the worker exits.
   */
  private async applicationLoop(): Promise<void> {
    try {
      // Run the loop in a cls-hooked namespace to provide the message handling context to all async operations
      while (this.internalState === BusState.Started) {
        const readStartedAt = Date.now()
        const messageRead = await this.handleNextMessage()

        // Avoids locking up CPU when there are no messages to be processed. A transport that waited for a message
        // before coming back empty, as the in-memory queue and long polling brokers do, has already waited, and
        // sleeping on top of that would delay a message that arrives straight after.
        if (!messageRead) {
          const readDuration = Date.now() - readStartedAt
          if (readDuration < EMPTY_QUEUE_SLEEP_MS) {
            await sleep(EMPTY_QUEUE_SLEEP_MS - readDuration)
          }
        }
      }
    } finally {
      this.runningWorkerCount--
    }
  }

  /**
   * Reads and handles the next message from the transport
   * @returns true if a message was read, whatever happened to it, so the worker reads the next one straight away
   */
  private async handleNextMessage(): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()
      if (message) {
        await this.handleReceivedMessage(message)
        return true
      }
    } catch (error) {
      this.logger.error(
        'Failed to handle and dispatch message from transport',
        { error: serializeError(error) }
      )
    }
    return false
  }

  /**
   * Handles a message and settles it on the transport exactly once, after the incoming middleware and handlers
   * finish: deleted when handled, moved to the dead letter queue when failed with `failMessage()`, or retried or
   * dead-lettered as the recoverability policy decides when handling failed or `returnMessage()` was called.
   * @throws (with a Receiver) the handling error of a message that's being retried, so the host doesn't delete it,
   * or the transport's error if it couldn't be dead-lettered
   */
  private async handleReceivedMessage(
    message: TransportMessage<TTransportMessage>
  ): Promise<void> {
    let settlement: Settlement
    try {
      Object.freeze(message)

      this.logger.debug('Message read from transport', { message })

      this.messagesBeingHandled.add(message)
      settlement = await this.messageHandlingContext.run(
        message,
        async () =>
          this.messageLifecycleContext.run(
            { messageReturnedToQueue: false, messageFailed: false },
            async () => {
              let handlingFailure: { error: unknown } | undefined
              try {
                await this.middlewarePipeline.runIncoming(
                  this.createIncomingContext(message),
                  async () => this.dispatchMessageToHandlers(message)
                )
              } catch (error) {
                handlingFailure = { error }
              }

              // Settled outside the incoming middleware, so the message is still deleted when a middleware
              // doesn't call next()
              return this.settleMessage(message, handlingFailure)
            }
          ),
        true,
        message
      )
    } catch (error) {
      this.logger.error(
        'Failed to handle and dispatch message from transport',
        { error: serializeError(error) }
      )
      // Receivers expect the host to return the message to the queue for retry
      if (this.receiver) {
        throw error
      }
      return
    } finally {
      this.messagesBeingHandled.delete(message)
    }

    if (settlement.outcome === 'retried' && this.receiver) {
      // The receiver host deletes messages that succeed, so a retried message must be reported as failed
      this.logger.debug(
        'Message is being retried and will be reported to the receiver host as failed',
        { message }
      )
      throw settlement.error
    }
  }

  /**
   * Deletes, returns or dead-letters a message once its handling has finished
   * @param message the message that was handled
   * @param handlingFailure what the incoming middleware or handlers threw, if anything
   * @returns how the message was settled
   */
  private async settleMessage(
    message: TransportMessage<TTransportMessage>,
    handlingFailure: { error: unknown } | undefined
  ): Promise<Settlement> {
    const { messageReturnedToQueue, messageFailed } =
      this.messageLifecycleContext.get()
    const messageName = message.domainMessage.$name

    if (handlingFailure) {
      this.logger.error('Message was unsuccessfully handled', {
        busMessage: message,
        error: serializeError(handlingFailure.error)
      })
    }

    if (messageFailed) {
      await this.deadLetterMessage(
        message,
        handlingFailure
          ? handlingFailure.error
          : new FailMessageRequested(messageName)
      )
      return { outcome: 'deadLettered' }
    }

    if (!handlingFailure && !messageReturnedToQueue) {
      if (!this.receiver) {
        // Receivers assume that the host is responsible for deleting successful messages
        await this.transport.deleteMessage(message)
      }
      return { outcome: 'handled' }
    }

    const error = handlingFailure
      ? handlingFailure.error
      : new ReturnMessageRequested(messageName)
    const action = this.decideRecoverability(message, error)
    if (action.action === 'deadLetter') {
      await this.deadLetterMessage(message, error)
      return { outcome: 'deadLettered' }
    }

    this.logger.debug('Returning message to the queue for retry', {
      messageName,
      messageId: message.attributes.messageId,
      failedAttempts: this.failedAttemptsOf(message),
      delay: action.delay
    })
    try {
      await this.transport.returnMessage(message, action.delay)
    } catch (returnError) {
      if (!this.receiver) {
        throw returnError
      }
      // The host still retries the message once it's reported as failed, just without the policy's delay
      this.logger.error('Failed to return received message to the queue', {
        messageName,
        error: serializeError(returnError)
      })
    }
    return {
      outcome: 'retried',
      error: handlingFailure
        ? handlingFailure.error
        : new ReceivedMessageReturnedToQueue(message)
    }
  }

  /**
   * How many times handling a message has failed, counting the failure being settled
   */
  private failedAttemptsOf(message: TransportMessage<unknown>): number {
    // A transport or receiver written before failedAttempts existed may not set it
    return (message.failedAttempts ?? 0) + 1
  }

  /**
   * Asks the recoverability policy whether to retry or dead-letter a failed message. A policy that throws, or returns
   * anything but `deadLetter()` or `retry()` with a finite delay of 0 or more (such as `undefined` or a promise),
   * dead-letters it, so the message is kept but isn't retried in a tight loop.
   */
  private decideRecoverability(
    message: TransportMessage<TTransportMessage>,
    error: unknown
  ): RecoverabilityAction {
    try {
      const action: unknown = this.recoverability({
        error,
        message: message.domainMessage,
        attributes: message.attributes,
        failedAttempts: this.failedAttemptsOf(message)
      })
      if (isRecoverabilityAction(action)) {
        return action
      }
      if (action instanceof Promise) {
        // Policies are synchronous. Don't leave a rejection of the promise unhandled.
        action.catch(() => undefined)
      }
      this.logger.error(
        'Recoverability policy returned neither retry(delay) nor deadLetter(), so the message will be moved to the dead letter queue',
        {
          messageName: message.domainMessage.$name,
          action: String(action)
        }
      )
      return deadLetter()
    } catch (policyError) {
      this.logger.error(
        'Recoverability policy threw, so the message will be moved to the dead letter queue',
        {
          messageName: message.domainMessage.$name,
          error: serializeError(policyError)
        }
      )
      return deadLetter()
    }
  }

  /**
   * Moves a message to the dead letter queue with its failure metadata
   */
  private async deadLetterMessage(
    message: TransportMessage<TTransportMessage>,
    error: unknown
  ): Promise<void> {
    const failure = createMessageFailure(error, {
      failedAttempts: this.failedAttemptsOf(message),
      endpoint: this.transport.endpointName,
      messageId: message.attributes.messageId
    })
    this.logger.warn('Moving message to the dead letter queue', {
      messageName: message.domainMessage.$name,
      failure
    })
    await this.transport.fail(message, failure)
  }

  private async dispatchMessageToHandlers(
    transportMessage: TransportMessage<TTransportMessage>
  ): Promise<void> {
    const message = transportMessage.domainMessage
    const handlers = this.coreDependencies.handlerRegistry.get(
      this.coreDependencies.loggerFactory,
      message
    )
    if (handlers.length === 0) {
      this.logger.error(
        `No handlers registered for message. Message will be discarded`,
        { messageName: message.$name }
      )
      return
    }

    // The handlers share one outbox, so a handler that fails drops what the others sent too, rather than leaving it
    // to be sent again when the message is retried
    await this.runInOutbox(message, async () => {
      const handlerResults = await Promise.allSettled(
        handlers.map(async handler =>
          this.dispatchMessageToHandler(transportMessage, handler)
        )
      )
      const failedHandlers = handlerResults.filter(r => r.status === 'rejected')
      if (failedHandlers.length) {
        const reasons = (failedHandlers as PromiseRejectedResult[]).map(
          h => h.reason
        )
        throw new HandlerDispatchRejected(reasons)
      }
    })

    this.logger.debug('Message dispatched to all handlers', {
      message,
      numHandlers: handlers.length
    })
  }

  /**
   * Buffers an outgoing message in the current outbox, if there is one: that of the message being handled, or of a
   * `transaction()`.
   * @returns true if the outbox took the message (buffered or dropped), or false if it should be dispatched now
   */
  private addToOutbox(outgoingMessage: OutboxedMessage): boolean {
    // The outbox only exists while handlers are running. Sends from elsewhere in the handling context, such as
    // incoming middleware, have no outbox and are dispatched directly.
    const outbox = this.outbox.getStore()
    if (!outbox) {
      return false
    }

    const { message } = outgoingMessage
    switch (outbox.state) {
      case OutboxState.Open:
        outgoingMessage.sentBy = this.unitOfWorkContext.currentScope()
        outbox.messages.push(outgoingMessage)
        return true
      case OutboxState.Flushed:
        this.logger.warn(
          'Message was sent after its handler resolved, so it will be dispatched immediately instead of outboxed. Await all sends in the handler to avoid this.',
          { message }
        )
        return false
      case OutboxState.Discarded:
        this.logger.warn(
          'Message was sent after its handler failed and will be dropped',
          { message }
        )
        dropOutgoing(
          outgoingMessage,
          outbox.discardReason ?? OutgoingMessageDropReason.HandlerFailed
        )
        return true
    }
  }

  /**
   * Creates the context passed to a handler. Its methods delegate to this bus, so sends go through the handler's
   * outbox and pick up the correlation and sticky attributes of the message being handled, including the
   * workflow id when called from a workflow handler. Replies use the attributes the message arrived with instead.
   */
  private createHandlerContext(
    transportMessage: TransportMessage<TTransportMessage>
  ): HandlerContext {
    return Object.freeze({
      correlationId: transportMessage.attributes.correlationId,
      // Only set inside the outbox of a message, so incoming middleware, which runs outside it, has none
      transaction: this.outbox.getStore()?.transaction,
      send: async <TCommand extends Command>(
        command: TCommand,
        options?: SendOptions
      ) => this.send(command, options),
      publish: async <TEvent extends Event>(
        event: TEvent,
        options?: SendOptions
      ) => this.publish(event, options),
      reply: async <TMessage extends Message>(
        message: TMessage,
        messageAttributes?: Partial<MessageAttributes>
      ) => this.reply(transportMessage, message, messageAttributes),
      failMessage: async () => this.failMessage(),
      returnMessage: async () => this.returnMessage()
    })
  }

  /**
   * Replies to a message by sending a message straight to its return address, through the outgoing middleware and
   * the handler's outbox like a send. The reply inherits the correlation id and sticky attributes the message
   * arrived with, rather than those of the current handling context, which a workflow handler changes to carry its
   * own workflow id.
   * @param request the message being replied to
   * @param message the reply
   * @param messageAttributes attributes to send the reply with, which replace the inherited ones
   * @throws ReplyOutsideHandlingContext if this bus isn't handling `request` in the current async context, or the
   * handler that replies has already finished
   * @throws DelayedReplyNotSupported if `deliverAfter` or `deliverAt` is given
   * @throws ReturnAddressMissing if the message being replied to has no return address
   * @throws TransportReplyNotSupported if the transport doesn't implement `sendToAddress`
   */
  private async reply(
    request: TransportMessage<TTransportMessage>,
    message: Message,
    messageAttributes: Partial<MessageAttributes> = {}
  ): Promise<void> {
    if (!this.isHandlingInCurrentContext(request)) {
      throw new ReplyOutsideHandlingContext(message.$name)
    }
    // Typed out of reply(), but a caller may pass the options it gives send()
    if (
      'deliverAfter' in messageAttributes ||
      'deliverAt' in messageAttributes
    ) {
      throw new DelayedReplyNotSupported(message.$name)
    }
    const destination = request.attributes.replyTo
    if (!destination) {
      throw new ReturnAddressMissing(request.domainMessage.$name, message.$name)
    }
    if (!this.transport.sendToAddress) {
      throw new TransportReplyNotSupported(
        this.transport.constructor.name,
        message.$name
      )
    }
    this.logger.debug('Replying to message', {
      message,
      destination,
      messageAttributes
    })
    await this.dispatchOutgoing(
      {
        kind: 'reply',
        message,
        destination,
        attributes: this.prepareTransportOptions(
          messageAttributes,
          request.attributes
        ),
        headers: {}
      },
      undefined
    )
  }

  /**
   * Whether `request` is the message being handled in the current async context, and its handler, if one is
   * running there, hasn't finished. A handler context that was kept and called while another message is handled,
   * or from a timer that fires after its handler resolved, isn't.
   */
  private isHandlingInCurrentContext(
    request: TransportMessage<TTransportMessage>
  ): boolean {
    // Compared with the received message, since a workflow handler runs in a copy of the handling context
    const isRequest =
      this.messageHandlingContext.getReceived() === request &&
      this.messagesBeingHandled.has(request)
    const outbox = this.outbox.getStore()
    return isRequest && (!outbox || outbox.state === OutboxState.Open)
  }

  /**
   * Creates the context passed to incoming middleware. It's frozen, like the message it describes.
   */
  private createIncomingContext(
    transportMessage: TransportMessage<TTransportMessage>
  ): IncomingContext {
    return Object.freeze({
      ...this.createHandlerContext(transportMessage),
      message: transportMessage.domainMessage,
      attributes: transportMessage.attributes,
      transportMessage,
      requestedSettlement: requestedSettlementOf(
        this.messageLifecycleContext.bindToCurrent()
      )
    })
  }

  /**
   * Runs the outgoing middleware for a message being sent or published. Its last step buffers the message in the
   * current handler's outbox, or when there's no handler running, sends it to the transport, or stores it in the
   * persistence if it's due later.
   * @param dueAt when the message is due, if it was sent with `deliverAfter` or `deliverAt`
   */
  private async dispatchOutgoing(
    draft: OutgoingDraft,
    dueAt: Date | undefined
  ): Promise<void> {
    const settle = Promise.withResolvers<void>()
    // Middleware may never look at it, so a rejection mustn't be reported as unhandled
    void settle.promise.catch(() => undefined)
    // A time that has already passed is sent straight away
    const delayedUntil =
      dueAt && dueAt.getTime() > Date.now() ? dueAt : undefined
    const context = {
      ...draft,
      ...(delayedUntil ? { dueAt: delayedUntil } : {}),
      dispatched: settle.promise
    } as OutgoingContext
    let dispatched = false
    let outboxed: OutboxedMessage | undefined
    try {
      await this.middlewarePipeline.runOutgoing(context, async () => {
        dispatched = true
        const outgoingMessage = snapshotOutgoing(context, settle)
        // Checked before buffering, so the caller's send rejects rather than the outbox failing when it's flushed
        if (Object.hasOwn(outgoingMessage.headers, FAILURE_HEADER)) {
          // The bus writes it on dead-lettered messages, whatever the transport
          throw new TransportHeaderReserved(
            FAILURE_HEADER,
            this.transport.constructor.name
          )
        }
        this.transport.assertSendOptions?.({ headers: outgoingMessage.headers })
        if (delayedUntil) {
          outgoingMessage.dueAt = delayedUntil
        }
        if (this.addToOutbox(outgoingMessage)) {
          outboxed = outgoingMessage
          return
        }
        if (isDelayed(outgoingMessage)) {
          await this.storeAndSettle([outgoingMessage])
        } else {
          await settleDispatched(
            [outgoingMessage],
            this.dispatchToTransport(outgoingMessage)
          )
        }
      })
    } catch (error) {
      // A middleware that throws after next() still rejects the send, so take back what was buffered
      const outbox = this.outbox.getStore()
      if (outbox && outboxed) {
        outbox.messages = outbox.messages.filter(m => m !== outboxed)
      }
      // A no-op if the message already reached the transport, or the transport's error already rejected it
      dropOutgoing(
        { message: context.message, settle },
        OutgoingMessageDropReason.Rejected,
        error
      )
      throw error
    }

    if (!dispatched) {
      dropOutgoing(
        { message: context.message, settle },
        OutgoingMessageDropReason.MiddlewareSkipped
      )
      this.logger.debug('Outgoing message was dropped by middleware', {
        kind: context.kind,
        message: context.message
      })
    }
  }

  /**
   * Sends, publishes or replies with a message on the transport, with the headers set by outgoing middleware
   */
  private async dispatchToTransport(
    outgoingMessage: OutgoingDraft
  ): Promise<void> {
    const { attributes, headers } = outgoingMessage
    switch (outgoingMessage.kind) {
      case 'send':
        await this.transport.send(outgoingMessage.message, attributes, {
          headers
        })
        return
      case 'publish':
        await this.transport.publish(outgoingMessage.message, attributes, {
          headers
        })
        return
      case 'reply':
        if (!this.transport.sendToAddress) {
          // reply() checked this, so it only happens if the transport changed since
          throw new TransportReplyNotSupported(
            this.transport.constructor.name,
            outgoingMessage.message.$name
          )
        }
        await this.transport.sendToAddress(
          outgoingMessage.destination,
          outgoingMessage.message,
          attributes,
          { headers }
        )
    }
  }

  /**
   * Works out when a message sent with `deliverAfter` or `deliverAt` is due, and warns once if the persistence
   * won't keep it through a restart
   * @returns when the message is due, or `undefined` if it's sent straight away
   * @throws InvalidDeliveryOptions if `deliverAfter` or `deliverAt` isn't a usable time, or both are given
   * @throws DelayedDeliveryNotSupported if the persistence can't store messages to send later
   */
  private resolveDueAt(
    message: Message,
    options: SendOptions
  ): Date | undefined {
    if (!assertDeliveryOptions(message, options)) {
      return undefined
    }
    const { deliverAfter, deliverAt } = options
    if (!isOutgoingMessageStore(this.persistence)) {
      throw new DelayedDeliveryNotSupported(this.persistence.constructor.name)
    }
    const neverDispatches =
      this.sendOnly || !!this.receiver || !this.delayedDelivery.dispatch
    const isSharedWithAnotherBus =
      (PERSISTENCE_USERS.get(this.persistence) ?? 0) > 1
    if (
      neverDispatches &&
      this.persistence.durable === false &&
      !isSharedWithAnotherBus
    ) {
      // Nothing would ever send it: this bus doesn't dispatch, and no other process can see the store
      throw new DelayedDeliveryNotSupported(
        this.persistence.constructor.name,
        DelayedDeliveryUnsupportedReason.NeverSent
      )
    }
    if (
      this.persistence.durable === false &&
      !this.hasWarnedOfNonDurableDelivery
    ) {
      this.hasWarnedOfNonDurableDelivery = true
      this.logger.warn(
        `Messages sent with deliverAfter or deliverAt are stored in ${this.persistence.constructor.name}, which doesn't survive a restart, so they're lost if the process stops before they're due. Configure a durable persistence with withPersistence(), such as PostgresPersistence from @node-ts/bus-postgres.`,
        { persistence: this.persistence.constructor.name }
      )
    }
    return deliverAt ?? new Date(Date.now() + (deliverAfter ?? 0))
  }

  /**
   * Stores delayed messages, and settles their `dispatched` promises: resolved once stored, rejected as `duplicate`
   * when a message with the same `messageId` was already stored, or with the persistence's error, which is rethrown
   */
  private async storeAndSettle(
    outgoingMessages: DelayedMessage[]
  ): Promise<void> {
    // Stores don't agree on how they report an id repeated within one batch, so only the first is given to the store
    const { unique, repeated } = splitRepeatedIds(outgoingMessages)
    if (repeated.length > 0) {
      this.warnOfDuplicates(repeated.map(m => m.attributes.messageId!))
    }
    repeated.forEach(m => dropOutgoing(m, OutgoingMessageDropReason.Duplicate))
    let stored: boolean[]
    try {
      stored = await this.storeOutgoing(unique)
    } catch (error) {
      unique.forEach(m => m.settle.reject(error))
      throw error
    }
    unique.forEach((m, index) =>
      stored[index]
        ? m.settle.resolve()
        : dropOutgoing(m, OutgoingMessageDropReason.Duplicate)
    )
  }

  /**
   * Warns that delayed messages weren't stored, because messages with the same `messageId` are already scheduled
   * @param duplicateIds the ids of the messages that weren't stored
   */
  private warnOfDuplicates(duplicateIds: string[]): void {
    this.logger.warn(
      'Scheduled messages were not stored, because messages with the same messageId are already scheduled. Give each message sent with deliverAfter or deliverAt a messageId of its own.',
      { duplicateIds }
    )
  }

  /**
   * Stores messages in the persistence to send once they're due
   * @returns whether each message was stored, in order. One whose id was already stored is skipped. The ids must be
   * unique within `outgoingMessages`, so the store only reports ids it already had.
   * @throws DelayedDeliveryNotSupported if the persistence can't store messages to send later, which `send()` and
   * `publish()` have already checked
   */
  private async storeOutgoing(
    outgoingMessages: DelayedMessage[]
  ): Promise<boolean[]> {
    if (!isOutgoingMessageStore(this.persistence)) {
      throw new DelayedDeliveryNotSupported(this.persistence.constructor.name)
    }
    const toStore = outgoingMessages.map(outgoingMessage =>
      this.toOutgoingMessage(outgoingMessage, outgoingMessage.dueAt)
    )
    const duplicateIds = await this.persistence.storeOutgoingMessages(toStore)
    if (duplicateIds.length > 0) {
      this.warnOfDuplicates(duplicateIds)
    }
    this.logger.debug('Stored outgoing messages to send when they are due', {
      outgoingMessages: toStore.map(({ id, kind, dueAt }) => ({
        id,
        kind,
        dueAt
      }))
    })
    toStore.forEach(({ dueAt }) =>
      this.outgoingMessageDispatcher?.scheduled(dueAt)
    )
    const skipped = new Set(duplicateIds)
    return toStore.map(({ id }) => !skipped.has(id))
  }

  /**
   * Converts a buffered message to the plain JSON the persistence stores
   * @param dueAt when it can be sent
   * @param leaseMs how long only this process may send it, for a message it sends straight away
   */
  private toOutgoingMessage(
    outboxedMessage: OutboxedMessage,
    dueAt: Date,
    leaseMs?: number
  ): OutgoingMessage {
    const { kind, message, attributes, headers } = outboxedMessage
    const { serializer } = this.coreDependencies
    return {
      id: attributes.messageId || randomUUID(),
      kind,
      message: serializer.toPlain(message),
      attributes: serializer.toPlain(attributes) as MessageAttributes,
      headers: { ...headers },
      dueAt,
      ...(outboxedMessage.kind === 'reply'
        ? { destination: outboxedMessage.destination }
        : {}),
      ...(leaseMs === undefined ? {} : { leaseMs })
    }
  }

  /**
   * Sends a message from the persistence that's due, as the outgoing middleware left it when it was stored. Its
   * classes are restored with this bus' message types where it has them, for transports that don't serialize.
   * @throws OutgoingMessageDestinationMissing if it's a reply the persistence returned without its destination
   */
  private async sendStoredMessage(
    outgoingMessage: OutgoingMessage
  ): Promise<void> {
    const { messageSerializer } = this.coreDependencies
    const message = messageSerializer.deserialize(
      messageSerializer.serialize(outgoingMessage.message as Message)
    )
    const { attributes, headers } = outgoingMessage
    switch (outgoingMessage.kind) {
      case 'send':
        await this.dispatchToTransport({
          kind: 'send',
          message: message as Command,
          attributes,
          headers
        })
        return
      case 'publish':
        await this.dispatchToTransport({
          kind: 'publish',
          message: message as Event,
          attributes,
          headers
        })
        return
      case 'reply':
        if (!outgoingMessage.destination) {
          throw new OutgoingMessageDestinationMissing(
            outgoingMessage.id,
            message.$name
          )
        }
        await this.dispatchToTransport({
          kind: 'reply',
          message,
          destination: outgoingMessage.destination,
          attributes,
          headers
        })
    }
  }

  /**
   * Fills in the attributes of an outgoing message
   * @param clientOptions the attributes given by the caller, which win over everything else
   * @param inherited the attributes to take the correlation id and sticky attributes from. By default, those of the
   * current handling context, which a workflow handler gives its own workflow id.
   */
  private prepareTransportOptions(
    clientOptions: Partial<MessageAttributes>,
    inherited: MessageAttributes | undefined = this.messageHandlingContext.get()
      ?.attributes
  ): MessageAttributes {
    const messageAttributes: MessageAttributes = {
      correlationId:
        clientOptions.correlationId || inherited?.correlationId || randomUUID(),
      // Unlike the correlation id, these identify this message, so they're never copied from the one being handled
      messageId: clientOptions.messageId || randomUUID(),
      sentAt: clientOptions.sentAt || new Date().toISOString(),
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...inherited?.stickyAttributes,
        ...clientOptions.stickyAttributes
      }
    }
    // Passing replyTo, even as undefined, replaces this bus' return address
    const replyTo = Object.hasOwn(clientOptions, 'replyTo')
      ? clientOptions.replyTo
      : this.returnAddress
    if (replyTo) {
      messageAttributes.replyTo = replyTo
    }

    this.logger.debug('Prepared transport options', { messageAttributes })

    return messageAttributes
  }

  /**
   * Calls one handler for a message, wrapped in the handler middleware, inside the outbox the message's handlers
   * share
   */
  private async dispatchMessageToHandler(
    transportMessage: TransportMessage<TTransportMessage>,
    handler: HandlerDefinition
  ): Promise<void> {
    const { domainMessage: message, attributes } = transportMessage
    const context = this.createHandlerContext(transportMessage)
    const invocationContext: HandlerInvocationContext = Object.freeze({
      ...context,
      message,
      attributes,
      transportMessage,
      requestedSettlement: requestedSettlementOf(
        this.messageLifecycleContext.bindToCurrent()
      ),
      handlerName: handlerNameOf(handler)
    })

    // The workflow registry opens a scope of its own for each workflow instance the handler handles
    await this.unitOfWorkContext.runInScope(
      { name: handlerNameOf(handler) },
      async () =>
        this.middlewarePipeline.runHandler(invocationContext, async () =>
          this.invokeHandler(message, attributes, handler, context)
        )
    )
  }

  /**
   * Dispatches the messages buffered while the handlers ran, once they all resolve. If the message being handled was
   * failed or returned by then, with `failMessage()` or `returnMessage()`, the outbox is discarded instead and its
   * transaction rolled back, as when a handler throws: the message will be dead-lettered or handled again, so its
   * sends would be wrong or duplicated. That's decided first, before anything is dispatched.
   *
   * With `withOutbox()`, the messages are stored in the outbox's transaction, which is committed before any is sent.
   * Without it, the workflow state the handlers saved is saved first, then the messages are sent.
   * @param message the message being handled, or `undefined` for the outbox of a `transaction()`
   * @throws TransactionRolledBack if work given to `transaction()` threw while it was joined to the outbox's
   * transaction
   * @throws the persistence's error if the transaction can't be committed, or the workflow state can't be saved,
   * such as when it was saved elsewhere since it was read, in which case nothing is sent
   */
  private async flushOutbox(
    outbox: Outbox,
    message: Message | undefined
  ): Promise<void> {
    if (outbox.joinedWorkError) {
      discardOutbox(
        outbox,
        OutgoingMessageDropReason.TransactionWorkFailed,
        outbox.joinedWorkError.error
      )
      await this.rollback(outbox)
      throw new TransactionRolledBack(
        TransactionRollbackReason.JoinedWorkFailed,
        this.persistence.constructor.name,
        outbox.joinedWorkError.error
      )
    }

    if (message && this.messageLifecycleContext.isFailedOrReturned()) {
      if (outbox.messages.length > 0) {
        this.logger.debug(
          'Message was failed or returned, so the messages its handlers sent are dropped',
          { messageName: message.$name, dropped: outbox.messages.length }
        )
      }
      discardOutbox(outbox, OutgoingMessageDropReason.MessageFailedOrReturned)
      await this.rollback(outbox)
      return
    }

    if (outbox.transaction) {
      // Close the outbox before flushing so that any later sends go straight to the transport instead of being lost
      outbox.state = OutboxState.Flushed
      const outboxedMessages = outbox.messages
      outbox.messages = []
      await this.commitOutbox(outbox, outbox.transaction, outboxedMessages)
      return
    }

    // Saved before anything is sent, so a state saved elsewhere since it was read fails the message, and the retry
    // makes the changes and sends the messages again
    const saves = await outbox.workflowStateSaves?.apply()
    if (saves?.failure) {
      await this.sendForSavedScopes(outbox, saves.savedBy)
      discardOutbox(
        outbox,
        OutgoingMessageDropReason.HandlerFailed,
        saves.failure.error
      )
      throw saves.failure.error
    }

    // Close the outbox before flushing so that any later sends go straight to the transport instead of being lost
    outbox.state = OutboxState.Flushed
    // Only reached when the message wasn't failed or returned, so a discarded outbox schedules nothing either
    const outboxedMessages = outbox.messages
    outbox.messages = []
    await this.dispatchOutboxed(outboxedMessages)
  }

  /**
   * Sends the messages of the handler calls and workflow instances whose workflow state was saved before another save
   * failed, on a bus without `withOutbox()`. The message is then retried, and those handlers find their state saved, so they could
   * skip sending the messages again: sending them now means they may be sent twice, but aren't lost. A failure to send
   * them is logged, since the message fails anyway.
   */
  private async sendForSavedScopes(
    outbox: Outbox,
    savedBy: Set<UnitOfWorkScope>
  ): Promise<void> {
    const toSend = outbox.messages.filter(
      ({ sentBy }) => sentBy !== undefined && savedBy.has(sentBy)
    )
    if (toSend.length === 0) {
      return
    }
    outbox.messages = outbox.messages.filter(m => !toSend.includes(m))
    this.logger.warn(
      "Saving a workflow's state failed after other workflows' state was saved, so the messages those workflows sent are sent before the message is retried. They may be sent again by the retry. Use withOutbox() to save state and send messages together.",
      {
        savedBy: [...savedBy].map(({ name }) => name),
        numMessages: toSend.length
      }
    )
    try {
      await this.dispatchOutboxed(toSend)
    } catch (error) {
      this.logger.error(
        'Failed to send the messages of workflows whose state was saved',
        { error: serializeError(error) }
      )
    }
  }

  /**
   * Stores the delayed messages of an outbox and sends the rest, a few at a time, settling their `dispatched`
   * promises
   * @throws the persistence's or transport's error, once every message has been sent or dropped
   */
  private async dispatchOutboxed(
    outboxedMessages: OutboxedMessage[]
  ): Promise<void> {
    const delayedMessages = outboxedMessages.filter(isDelayed)
    const immediateMessages = outboxedMessages.filter(m => !isDelayed(m))
    if (delayedMessages.length > 0) {
      try {
        await this.storeAndSettle(delayedMessages)
      } catch (error) {
        immediateMessages.forEach(m =>
          dropOutgoing(m, OutgoingMessageDropReason.OutboxFlushFailed)
        )
        throw error
      }
    }
    if (immediateMessages.length > 0) {
      // In case of a large number of messages to send, use a worker pool to dispatch so that we don't blow out heap usage
      const dispatchWorkerCount = Math.min(immediateMessages.length, 10)
      const workers = new Array(dispatchWorkerCount)
        .fill(undefined)
        .map(async () => {
          while (true) {
            const messageToSend = immediateMessages.shift()
            if (messageToSend === undefined) {
              break
            }
            // The outgoing middleware already ran when the message was sent, so it isn't run again. It's sent in
            // the async context it was sent in, so tracing spans started around next() are active.
            await messageToSend.runInSendContext(async () =>
              settleDispatched(
                [messageToSend],
                this.dispatchToTransport(messageToSend)
              )
            )
          }
        })

      const results = await Promise.allSettled(workers)
      // Each worker stops at its first failed send, so messages are only left over when every worker failed
      immediateMessages.forEach(m =>
        dropOutgoing(m, OutgoingMessageDropReason.OutboxFlushFailed)
      )
      const failure = results.find(result => result.status === 'rejected')
      if (failure) {
        throw failure.reason
      }
    }
  }

  /**
   * Runs work with an outbox of its own, which holds the messages it sends until it resolves: one for each message
   * received, which all of its handlers share, and one for each `transaction()`. With `withOutbox()`, the work runs in
   * a transaction of the persistence too, which the outbox is stored in and committed with, and workflow state is
   * read and saved in it. Without it, the workflow state saved is held until the outbox is flushed. If the work
   * throws, the outbox is discarded and the transaction rolled back.
   * @param message the message being handled, or `undefined` for a `transaction()`
   * @param work what to run, given its outbox
   * @returns what the work returns, once the outbox is flushed
   * @throws the error the work throws, or the persistence's error if the transaction can't be begun or committed
   */
  private async runInOutbox<TResult>(
    message: Message | undefined,
    work: (outbox: Outbox) => Promise<TResult>
  ): Promise<TResult> {
    const transaction = await this.outboxPersistence?.beginTransaction()
    const workflowStateSaves = transaction
      ? undefined
      : new BufferedWorkflowStateStore(this.persistence, () =>
          this.unitOfWorkContext.currentScope()
        )
    const outbox: Outbox = {
      state: OutboxState.Open,
      messages: [],
      transaction,
      transactionEnded: false,
      workflowStateSaves,
      joinedWorkError: undefined
    }
    return this.outbox.run(outbox, async () =>
      this.unitOfWorkContext.run(
        transaction ?? workflowStateSaves!,
        async () => {
          try {
            let result: TResult
            try {
              result = await work(outbox)
            } catch (error) {
              discardOutbox(
                outbox,
                message
                  ? OutgoingMessageDropReason.HandlerFailed
                  : OutgoingMessageDropReason.TransactionWorkFailed,
                error
              )
              throw error
            }
            await this.flushOutbox(outbox, message)
            return result
          } finally {
            // Whatever failed, such as a message that couldn't be converted to store it, the transaction is never left
            // open, holding its connection and locks
            await this.rollback(outbox)
          }
        }
      )
    )
  }

  /**
   * Stores an outbox's messages in its transaction and commits it, then sends the messages that aren't delayed and
   * deletes them from the store. The others are sent by the dispatcher once they're due.
   *
   * Their `dispatched` promises settle at the commit: resolved for those committed, which the dispatcher sends if
   * sending them now fails, rejected as `duplicate` for those whose `messageId` was already stored, or rejected as
   * `transaction-failed` if nothing could be kept.
   * @throws the persistence's error if the messages can't be converted or stored, or the transaction committed, in
   * which case nothing was kept or sent. The caller rolls the transaction back if it's still open.
   */
  private async commitOutbox(
    outbox: Outbox,
    transaction: PersistenceTransaction,
    outboxedMessages: OutboxedMessage[]
  ): Promise<void> {
    const { leaseMs, sendTimeoutMs } =
      DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS
    const storedAt = Date.now()
    // Stores don't agree on how they report an id repeated within one batch, so only the first is given to the store
    const { unique, repeated } = splitRepeatedIds(outboxedMessages)
    let committed: CommittedMessage[]
    let duplicateIds: string[]
    try {
      const toStore = unique.map((outboxedMessage): CommittedMessage => ({
        outboxedMessage,
        outgoingMessage: isDelayed(outboxedMessage)
          ? this.toOutgoingMessage(outboxedMessage, outboxedMessage.dueAt)
          : // Only this process sends it until the lease ends, so the dispatcher doesn't send it at the same time
            this.toOutgoingMessage(outboxedMessage, new Date(storedAt), leaseMs)
      }))
      duplicateIds =
        toStore.length > 0
          ? await transaction.storeOutgoingMessages(
              toStore.map(({ outgoingMessage }) => outgoingMessage)
            )
          : []
      // Ends the transaction, even when it throws
      outbox.transactionEnded = true
      await transaction.commit()
      const notStoredIds = new Set(duplicateIds)
      committed = toStore.filter(
        ({ outgoingMessage: { id } }) => !notStoredIds.has(id)
      )
    } catch (error) {
      outboxedMessages.forEach(m =>
        dropOutgoing(m, OutgoingMessageDropReason.TransactionFailed, error)
      )
      throw error
    }

    const allDuplicateIds = [
      ...repeated.map(m => m.attributes.messageId!),
      ...duplicateIds
    ]
    if (allDuplicateIds.length > 0) {
      this.logger.warn(
        'Messages were not stored in the outbox, because messages with the same messageId are already stored. Give each message its own messageId.',
        { duplicateIds: allDuplicateIds }
      )
    }
    const committedMessages = new Set(
      committed.map(({ outboxedMessage }) => outboxedMessage)
    )
    outboxedMessages.forEach(m =>
      committedMessages.has(m)
        ? m.settle.resolve()
        : dropOutgoing(m, OutgoingMessageDropReason.Duplicate)
    )
    committed
      .filter(({ outboxedMessage }) => isDelayed(outboxedMessage))
      .forEach(({ outgoingMessage }) =>
        this.outgoingMessageDispatcher?.scheduled(outgoingMessage.dueAt)
      )
    await this.sendCommittedMessages(
      committed.filter(({ outboxedMessage }) => !isDelayed(outboxedMessage)),
      // A send can take up to sendTimeoutMs, and mustn't outlive the lease, or the dispatcher could send it too
      storedAt + leaseMs - sendTimeoutMs
    )
  }

  /**
   * Sends messages committed to the store, a few at a time, and deletes them once they're sent. Once one fails or
   * times out, or the lease is nearly over, the rest are left in the store and released, so that the dispatcher of a
   * started bus that uses the persistence sends them on its next check. One that timed out keeps its lease, since it
   * may still be sent, and is sent again once the lease ends if it isn't deleted. It never throws, since the
   * messages are already committed.
   * @param sendBefore when, by this process' clock, no more sends start
   */
  private async sendCommittedMessages(
    committed: CommittedMessage[],
    sendBefore: number
  ): Promise<void> {
    const store = this.outboxPersistence
    if (!store || committed.length === 0) {
      return
    }
    const toSend = [...committed]
    const sentIds: string[] = []
    const timedOutIds: string[] = []
    const notSent: OutgoingMessageClaim[] = []
    let sendError: unknown
    // A pool of workers, so that a large number of messages doesn't blow out heap usage
    const workers = new Array(Math.min(toSend.length, OUTBOX_SEND_CONCURRENCY))
      .fill(undefined)
      .map(async () => {
        while (true) {
          const next = toSend.shift()
          if (next === undefined) {
            break
          }
          const { outboxedMessage, outgoingMessage } = next
          if (sendError !== undefined || Date.now() > sendBefore) {
            notSent.push({ id: outgoingMessage.id, attempts: 0 })
            continue
          }
          try {
            // The outgoing middleware already ran when the message was sent, so it isn't run again. It's sent in the
            // async context it was sent in, so tracing spans started around next() are active. Its dispatched promise
            // settled at the commit, since the dispatcher sends it if this fails.
            const sent = await outboxedMessage.runInSendContext(async () =>
              this.dispatchWithTimeout(outboxedMessage)
            )
            if (sent) {
              sentIds.push(outgoingMessage.id)
            } else {
              timedOutIds.push(outgoingMessage.id)
              // Only logged, so it doesn't need an error class
              sendError ??= {
                message: `Sending the message took longer than ${DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS.sendTimeoutMs}ms`
              }
            }
          } catch (error) {
            sendError ??= error
            notSent.push({ id: outgoingMessage.id, attempts: 0 })
          }
        }
      })
    await Promise.all(workers)

    if (sentIds.length > 0) {
      try {
        await store.deleteOutgoingMessages(sentIds)
      } catch (error) {
        this.logger.error(
          'Failed to delete messages from the outbox once they were sent. They will be sent again when their lease ends.',
          { numMessages: sentIds.length, error: serializeError(error) }
        )
      }
    }
    if (notSent.length === 0 && timedOutIds.length === 0) {
      return
    }
    this.logger.warn(
      'Messages were committed to the outbox but not sent straight away. They stay in the outbox, and a started bus that uses the same persistence sends them.',
      {
        numMessages: notSent.length + timedOutIds.length,
        timedOutIds,
        error: serializeError(sendError)
      }
    )
    if (notSent.length === 0) {
      return
    }
    try {
      // They've never been claimed, so releasing them with no attempts makes them claimable straight away
      await store.releaseOutgoingMessages(notSent)
      this.outgoingMessageDispatcher?.scheduled(new Date())
    } catch (error) {
      this.logger.debug(
        'Failed to release messages that were not sent from the outbox. They will be claimable when their lease ends.',
        { numMessages: notSent.length, error: serializeError(error) }
      )
    }
  }

  /**
   * Sends a message to the transport, giving up waiting after the dispatcher's `sendTimeoutMs`
   * @returns true if it was sent, or false if it took too long, in which case it may still be sent
   * @throws the transport's error if it failed in time
   */
  private async dispatchWithTimeout(
    outboxedMessage: OutboxedMessage
  ): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined
    const timedOut = new Promise<false>(resolve => {
      timeout = setTimeout(
        () => resolve(false),
        DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS.sendTimeoutMs
      )
    })
    // race() handles a rejection that comes after the timeout, so it's never unhandled
    const sent = this.dispatchToTransport(outboxedMessage).then(() => true)
    try {
      return await Promise.race([sent, timedOut])
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Rolls back an outbox's transaction, if it has one that hasn't ended. It never throws, so the error that caused
   * it isn't lost; the rollback ends the transaction even when it fails.
   */
  private async rollback(outbox: Outbox): Promise<void> {
    if (!outbox.transaction || outbox.transactionEnded) {
      return
    }
    outbox.transactionEnded = true
    try {
      await outbox.transaction.rollback()
    } catch (error) {
      this.logger.error('Failed to roll back a transaction', {
        error: serializeError(error)
      })
    }
  }

  /**
   * Warns when messages committed to the outbox that fail to send straight away would never be sent: this bus doesn't
   * send stored messages itself, and its persistence doesn't outlive the process or reach another bus.
   */
  private warnIfOutboxIsNeverDispatched(): void {
    const neverDispatches =
      this.sendOnly || !!this.receiver || !this.delayedDelivery.dispatch
    const isSharedWithAnotherBus =
      (PERSISTENCE_USERS.get(this.persistence) ?? 0) > 1
    if (
      this.outboxPersistence &&
      neverDispatches &&
      this.persistence.durable === false &&
      !isSharedWithAnotherBus
    ) {
      this.logger.warn(
        `Messages committed to the outbox that fail to send straight away are left in ${this.persistence.constructor.name} for a started bus to send, but this bus doesn't send them (it's send-only, has a receiver or has dispatching turned off), and ${this.persistence.constructor.name} isn't durable or used by another bus in this process, so they'd be lost. Use a durable persistence, such as PostgresPersistence from @node-ts/bus-postgres, that a started bus also uses.`,
        { persistence: this.persistence.constructor.name }
      )
    }
  }

  /**
   * Creates the context passed to the work of a `transaction()`. Its sends go through the transaction's outbox.
   */
  private createTransactionContext(
    transaction: PersistenceTransaction | undefined
  ): TransactionContext {
    return Object.freeze({
      transaction,
      send: async <TCommand extends Command>(
        command: TCommand,
        options?: SendOptions
      ) => this.send(command, options),
      publish: async <TEvent extends Event>(
        event: TEvent,
        options?: SendOptions
      ) => this.publish(event, options)
    })
  }

  /**
   * Resolves a class handler from the container, or constructs it, and calls it. A function handler is called as
   * it is.
   * @throws ClassHandlerNotResolved if a class handler can't be resolved or constructed
   */
  private async invokeHandler(
    message: Message,
    attributes: MessageAttributes,
    handler: HandlerDefinition,
    context: HandlerContext
  ): Promise<void> {
    if (!isClassHandler(handler)) {
      const fnHandler = handler as FunctionHandler<Message>
      await fnHandler(message, attributes, context)
      return
    }

    const classHandler = handler as ClassConstructor<Handler<Message>>
    const container = this.coreDependencies.container
    let handlerInstance: Handler<Message> | undefined
    if (!container) {
      // Without a container, class handlers are constructed like class workflows are
      try {
        handlerInstance = new classHandler()
      } catch (e) {
        throw new ClassHandlerNotResolved(
          classHandler.name,
          e instanceof Error ? e.message : String(e),
          e
        )
      }
    } else {
      try {
        handlerInstance = await container.get(classHandler, {
          message,
          messageAttributes: attributes
        })
      } catch (e) {
        throw new ClassHandlerNotResolved(
          classHandler.name,
          e instanceof Error ? e.message : String(e),
          e
        )
      }
      if (!handlerInstance) {
        throw new ClassHandlerNotResolved(
          classHandler.name,
          'Container failed to resolve an instance.'
        )
      }
    }

    await handlerInstance.handle(message, attributes, context)
  }

  /**
   * Subscribes to the interrupt signals to gracefully stop the bus. Listeners are
   * registered once per instance and removed when the bus is disposed.
   */
  /**
   * Checks every handled message and workflow state has an entry in the bus' message types, so a generated file
   * that's out of date or wasn't passed to `withMessageTypes()` is caught at startup. Send-only buses and buses
   * with no handlers or workflows only serialize, which doesn't need message types, so they aren't checked.
   * @throws MessageTypesMissing if any of them has no entry
   */
  private assertMessageTypesConfigured(): void {
    const { messageTypes } = this.coreDependencies
    const missingNames = [
      ...this.handlerRegistry.getMessageNames(),
      ...this.workflowRegistry.getWorkflowStateNames()
    ].filter(name => !Object.hasOwn(messageTypes.messages, name))
    if (missingNames.length) {
      throw new MessageTypesMissing(missingNames)
    }
  }

  private subscribeToInterruptSignals(signals: NodeJS.Signals[]): void {
    if (this.sendOnly) {
      // Only applies to message handling buses
      return
    }

    const startedStates = [BusState.Started, BusState.Starting]
    signals.forEach(signal => {
      const listener = () => {
        if (!startedStates.includes(this.state)) {
          // No need to stop a non-started bus
          return
        }
        this.logger.info(`Received ${signal} signal. Stopping bus...`)
        // Signal listeners can't be awaited, so log a failed stop instead of leaving it unhandled
        this.stop().catch(error =>
          this.logger.error('Failed to stop bus after an interrupt signal', {
            signal,
            error: serializeError(error)
          })
        )
      }
      process.on(signal, listener)
      this.interruptSignalListeners.push({ signal, listener })
    })
  }

  /**
   * Removes the interrupt signal listeners added by `subscribeToInterruptSignals()`
   */
  private unsubscribeFromInterruptSignals(): void {
    this.interruptSignalListeners.forEach(({ signal, listener }) =>
      process.off(signal, listener)
    )
    this.interruptSignalListeners = []
  }
}
