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
  OutgoingReplyContext
} from '../middleware'
import { MiddlewarePipeline } from '../middleware/middleware-pipeline'
import {
  DelayedDeliveryNotSupported,
  DelayedDeliveryOptions,
  DelayedDeliveryUnsupportedReason,
  InvalidDeliveryOptions,
  OutgoingMessage,
  SendOptions
} from '../outgoing-message'
import {
  isOutgoingMessageStore,
  OutgoingMessageDispatcher
} from '../outgoing-message/outgoing-message-dispatcher'
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
import { Persistence, PersistenceNotConfigured } from '../workflow/persistence'
import { WorkflowRegistry } from '../workflow/registry'
import { BusState } from './bus-state'
import { InvalidBusState, InvalidOperation } from './error'

const EMPTY_QUEUE_SLEEP_MS = 500

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
   * The handler is running, so outgoing messages are buffered
   */
  Open = 'open',
  /**
   * The handler resolved and its buffered messages were dispatched
   */
  Flushed = 'flushed',
  /**
   * The handler failed and its buffered messages were dropped
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
 * A message buffered in a handler's outbox, as the outgoing middleware left it, and when it's due if it's sent
 * later
 */
type OutboxedMessage = OutgoingContext & { dueAt?: Date }

/**
 * An outgoing message that's stored in the persistence until it's due
 */
type DelayedMessage = Exclude<OutgoingContext, OutgoingReplyContext> & {
  dueAt: Date
}

// Replies are never delayed, since reply() rejects deliverAfter and deliverAt
const isDelayed = (
  outgoingMessage: OutboxedMessage
): outgoingMessage is DelayedMessage =>
  outgoingMessage.dueAt !== undefined && outgoingMessage.kind !== 'reply'

interface Outbox {
  state: OutboxState
  messages: OutboxedMessage[]
}

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
const snapshotOutgoing = (context: OutgoingContext): OutboxedMessage => ({
  ...context,
  attributes: {
    ...context.attributes,
    attributes: { ...context.attributes.attributes },
    stickyAttributes: { ...context.attributes.stickyAttributes }
  },
  headers: { ...context.headers }
})

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
  private hasReleasedPersistence = false
  /**
   * The messages this bus is handling right now, so a reply is only sent while its request is being handled
   */
  private readonly messagesBeingHandled = new Set<TransportMessage<unknown>>()

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
    private readonly scheduler: boolean
  ) {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:service-bus'
    )
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
   * @throws InvalidOperation if the bus has already been initialized
   * @throws MessageTypesMissing if the bus receives messages, but a handled message or a workflow state has no
   * entry in the message types passed to `withMessageTypes()`
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing bus')

    if (this.isInitialized) {
      throw new InvalidOperation('Bus has already been initialized')
    }

    const usesPersistence =
      (!this.sendOnly && this.workflowRegistry.hasWorkflowsToInitialize()) ||
      isOutgoingMessageStore(this.persistence)
    if (usesPersistence && this.persistence.initialize) {
      this.logger.info('Initializing persistence...')
      await this.persistence.initialize()
    }

    if (!this.sendOnly) {
      await this.workflowRegistry.initialize(
        this.handlerRegistry,
        this.container
      )
      this.assertMessageTypesConfigured()
    }
    if (this.scheduler && !this.outgoingMessageDispatcher) {
      throw new DelayedDeliveryNotSupported(this.persistence.constructor.name)
    }

    if (this.transport.connect) {
      await this.transport.connect({
        concurrency: this.concurrency
      })
    }
    if (this.transport.initialize) {
      // A scheduler only sends, so its transport doesn't set up a queue to receive from
      await this.transport.initialize({
        handlerRegistry: this.handlerRegistry,
        sendOnly: this.sendOnly || this.scheduler
      })
    }

    this.subscribeToInterruptSignals(this.coreDependencies.interruptSignals)
    this.isInitialized = true
    this.logger.debug('Bus initialized', {
      sendOnly: this.sendOnly,
      registeredMessages: this.handlerRegistry.getMessageNames()
    })
  }

  /**
   * Publishes an event to the transport.
   *
   * The outgoing middleware runs first. Then, when called from inside a handler, the event is buffered and only
   * published once the handler resolves, and is dropped if the handler fails. Anywhere else (outside a handler, in
   * incoming middleware, or after the handler has already resolved) it's published straight away.
   *
   * With `deliverAfter` or `deliverAt`, the event is stored in the persistence instead of being published, and a
   * started bus that uses the same persistence publishes it once it's due. Inside a handler it's only stored once
   * the handler resolves.
   * @param event An event to publish
   * @param options A set of attributes to attach to the outgoing message when published, and when to publish it. A
   * new `messageId` and `sentAt` are set unless given, and so is this bus' return address (`replyTo`) unless it's
   * send-only. Pass `replyTo: undefined` to leave the return address out.
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
   * sent once the handler resolves, and is dropped if the handler fails. Anywhere else (outside a handler, in
   * incoming middleware, or after the handler has already resolved) it's sent straight away.
   *
   * With `deliverAfter` or `deliverAt`, the command is stored in the persistence instead of being sent, and a
   * started bus that uses the same persistence sends it once it's due. Inside a handler it's only stored once the
   * handler resolves.
   * @param command A command to send
   * @param options A set of attributes to attach to the outgoing message when sent, and when to send it. A new
   * `messageId` and `sentAt` are set unless given, and so is this bus' return address (`replyTo`) unless it's
   * send-only. Pass `replyTo: undefined` to leave the return address out.
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
   * `returnAddress`, or its `endpointName` when it has none. `undefined` for a send-only bus or a transport with
   * neither, which have no queue that's read.
   */
  private get returnAddress(): string | undefined {
    if (this.sendOnly) {
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
        const messageRead = await this.handleNextMessage()

        // Avoids locking up CPU when there are no messages to be processed
        if (!messageRead) {
          await sleep(EMPTY_QUEUE_SLEEP_MS)
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

    const handlersToInvoke = handlers.map(handler =>
      this.dispatchMessageToHandler(transportMessage, handler)
    )

    const handlerResults = await Promise.allSettled(handlersToInvoke)
    const failedHandlers = handlerResults.filter(r => r.status === 'rejected')
    if (failedHandlers.length) {
      const reasons = (failedHandlers as PromiseRejectedResult[]).map(
        h => h.reason
      )
      throw new HandlerDispatchRejected(reasons)
    }

    this.logger.debug('Message dispatched to all handlers', {
      message,
      numHandlers: handlersToInvoke.length
    })
  }

  /**
   * Buffers an outgoing message in the current handler's outbox, if there is one.
   * @returns true if the outbox took the message (buffered or dropped), or false if it should be dispatched now
   */
  private addToOutbox(outgoingMessage: OutboxedMessage): boolean {
    // The outbox only exists while a handler is running. Sends from elsewhere in the handling context, such as
    // incoming middleware, have no outbox and are dispatched directly.
    const outbox = this.outbox.getStore()
    if (!outbox) {
      return false
    }

    const { message } = outgoingMessage
    switch (outbox.state) {
      case OutboxState.Open:
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
      transportMessage
    })
  }

  /**
   * Runs the outgoing middleware for a message being sent or published. Its last step buffers the message in the
   * current handler's outbox, or when there's no handler running, sends it to the transport, or stores it in the
   * persistence if it's due later.
   * @param dueAt when the message is due, if it was sent with `deliverAfter` or `deliverAt`
   */
  private async dispatchOutgoing(
    context: OutgoingContext,
    dueAt: Date | undefined
  ): Promise<void> {
    let dispatched = false
    let outboxed: OutboxedMessage | undefined
    try {
      await this.middlewarePipeline.runOutgoing(context, async () => {
        dispatched = true
        const outgoingMessage: OutboxedMessage = snapshotOutgoing(context)
        // Checked before buffering, so the caller's send rejects rather than the outbox failing when it's flushed
        if (Object.hasOwn(outgoingMessage.headers, FAILURE_HEADER)) {
          // The bus writes it on dead-lettered messages, whatever the transport
          throw new TransportHeaderReserved(
            FAILURE_HEADER,
            this.transport.constructor.name
          )
        }
        this.transport.assertSendOptions?.({ headers: outgoingMessage.headers })
        if (dueAt && dueAt.getTime() > Date.now()) {
          outgoingMessage.dueAt = dueAt
        }
        if (this.addToOutbox(outgoingMessage)) {
          outboxed = outgoingMessage
          return
        }
        if (isDelayed(outgoingMessage)) {
          await this.storeOutgoing([outgoingMessage])
        } else {
          await this.dispatchToTransport(outgoingMessage)
        }
      })
    } catch (error) {
      // A middleware that throws after next() still rejects the send, so take back what was buffered
      const outbox = this.outbox.getStore()
      if (outbox && outboxed) {
        outbox.messages = outbox.messages.filter(m => m !== outboxed)
      }
      throw error
    }

    if (!dispatched) {
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
    outgoingMessage: OutboxedMessage
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
    { deliverAfter, deliverAt }: SendOptions
  ): Date | undefined {
    if (deliverAfter === undefined && deliverAt === undefined) {
      return undefined
    }
    if (deliverAfter !== undefined && deliverAt !== undefined) {
      throw new InvalidDeliveryOptions(
        'deliverAfter and deliverAt were both given',
        message.$name
      )
    }
    if (
      deliverAfter !== undefined &&
      (typeof deliverAfter !== 'number' ||
        !Number.isFinite(deliverAfter) ||
        deliverAfter < 0)
    ) {
      throw new InvalidDeliveryOptions(
        `deliverAfter must be a number of milliseconds that's 0 or more, but was ${String(deliverAfter)}`,
        message.$name
      )
    }
    if (
      deliverAt !== undefined &&
      (!(deliverAt instanceof Date) || Number.isNaN(deliverAt.getTime()))
    ) {
      throw new InvalidDeliveryOptions(
        `deliverAt must be a valid Date, but was ${String(deliverAt)}`,
        message.$name
      )
    }
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
   * Stores messages in the persistence to send once they're due
   * @throws DelayedDeliveryNotSupported if the persistence can't store messages to send later, which `send()` and
   * `publish()` have already checked
   */
  private async storeOutgoing(
    outgoingMessages: DelayedMessage[]
  ): Promise<void> {
    if (!isOutgoingMessageStore(this.persistence)) {
      throw new DelayedDeliveryNotSupported(this.persistence.constructor.name)
    }
    const { serializer } = this.coreDependencies
    const toStore = outgoingMessages.map(
      ({ kind, message, attributes, headers, dueAt }): OutgoingMessage => ({
        id: attributes.messageId || randomUUID(),
        kind,
        message: serializer.toPlain(message),
        attributes: serializer.toPlain(attributes) as MessageAttributes,
        headers: { ...headers },
        dueAt
      })
    )
    const duplicateIds = await this.persistence.storeOutgoingMessages(toStore)
    if (duplicateIds.length > 0) {
      this.logger.warn(
        'Scheduled messages were not stored, because messages with the same messageId are already scheduled. Give each message sent with deliverAfter or deliverAt a messageId of its own.',
        { duplicateIds }
      )
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
  }

  /**
   * Sends a message from the persistence that's due, as the outgoing middleware left it when it was stored. Its
   * classes are restored with this bus' message types where it has them, for transports that don't serialize.
   */
  private async sendStoredMessage(
    outgoingMessage: OutgoingMessage
  ): Promise<void> {
    const { messageSerializer } = this.coreDependencies
    const message = messageSerializer.deserialize(
      messageSerializer.serialize(outgoingMessage.message as Message)
    )
    const { attributes, headers } = outgoingMessage
    await this.dispatchToTransport(
      outgoingMessage.kind === 'send'
        ? { kind: 'send', message: message as Command, attributes, headers }
        : { kind: 'publish', message: message as Event, attributes, headers }
    )
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
   * Calls one handler for a message inside its own outbox, wrapped in the handler middleware. The outbox is flushed
   * once the handler and its middleware resolve, and discarded if either throws.
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
      handlerName: handlerNameOf(handler)
    })

    const outbox: Outbox = { state: OutboxState.Open, messages: [] }
    await this.outbox.run(outbox, async () => {
      try {
        await this.middlewarePipeline.runHandler(invocationContext, async () =>
          this.invokeHandler(message, attributes, handler, context)
        )
      } catch (error) {
        outbox.state = OutboxState.Discarded
        outbox.messages = []
        throw error
      }

      await this.flushOutbox(outbox, message)
    })
  }

  /**
   * Dispatches the messages a handler buffered once it resolves. If the message being handled was failed or
   * returned by then, with `failMessage()` or `returnMessage()`, the outbox is discarded instead, as when a handler
   * throws: the message will be dead-lettered or handled again, so its sends would be wrong or duplicated. That's
   * decided first, before anything is dispatched.
   */
  private async flushOutbox(outbox: Outbox, message: Message): Promise<void> {
    if (this.messageLifecycleContext.isFailedOrReturned()) {
      outbox.state = OutboxState.Discarded
      if (outbox.messages.length > 0) {
        this.logger.debug(
          'Message was failed or returned, so the messages its handler sent are dropped',
          { messageName: message.$name, dropped: outbox.messages.length }
        )
      }
      outbox.messages = []
      return
    }

    // Close the outbox before flushing so that any later sends go straight to the transport instead of being lost
    outbox.state = OutboxState.Flushed
    // Only reached when the message wasn't failed or returned, so a discarded outbox schedules nothing either
    const delayedMessages = outbox.messages.filter(isDelayed)
    const outboxedMessages = outbox.messages.filter(m => !isDelayed(m))
    outbox.messages = []
    if (delayedMessages.length > 0) {
      await this.storeOutgoing(delayedMessages)
    }
    if (outboxedMessages.length > 0) {
      // In case of a large number of messages to send, use a worker pool to dispatch so that we don't blow out heap usage
      const dispatchWorkerCount = Math.min(outboxedMessages.length, 10)
      const workers = new Array(dispatchWorkerCount)
        .fill(undefined)
        .map(async () => {
          while (true) {
            const messageToSend = outboxedMessages.shift()
            if (messageToSend === undefined) {
              break
            }
            // The outgoing middleware already ran when the message was sent, so it isn't run again
            await this.dispatchToTransport(messageToSend)
          }
        })

      await Promise.all(workers)
    }
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
