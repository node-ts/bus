import {
  Message,
  MessageAttributes,
  MessageDeclaration,
  MessageTypes,
  mergeMessageTypes
} from '@node-ts/bus-messages'
import { ContainerAdapter } from '../container'
import { ContainerNotRegistered } from '../error'
import { CustomResolver, DefaultHandlerRegistry, Handler } from '../handler'
import { HandlerDefinition, isClassHandler } from '../handler/handler'
import { LoggerFactory, createDefaultLoggerFactory } from '../logger'
import { MessageHandlingContext } from '../message-handling-context'
import { MessageLifecycleContext } from '../message-lifecycle-context'
import { BusMiddleware } from '../middleware'
import { MiddlewarePipeline } from '../middleware/middleware-pipeline'
import { DelayedDeliveryOptions } from '../outgoing-message'
import { Receiver } from '../receiver'
import { RecoverabilityPolicy, defaultRecoverability } from '../recoverability'
import { JsonSerializer, Serializer } from '../serialization'
import { MessageSerializer } from '../serialization/message-serializer'
import { InMemoryQueue, Transport } from '../transport'
import { ClassConstructor, CoreDependencies } from '../util'
import {
  FunctionWorkflow,
  Persistence,
  Workflow,
  WorkflowState
} from '../workflow'
import { InMemoryPersistence } from '../workflow/persistence'
import { WorkflowRegistry } from '../workflow/registry/workflow-registry'
import { BusInstance } from './bus-instance'
import {
  BusAlreadyInitialized,
  InvalidOperation,
  TransportAlreadyInUse
} from './error'

/**
 * Gets the message type a class handler handles. A `messageType` getter is read from the prototype without
 * constructing the handler. A `messageType` class field only exists on instances, so for backwards compatibility
 * the handler is constructed without its dependencies just to read it.
 */
const resolveClassHandlerMessageType = (
  handler: ClassConstructor<Handler>
): MessageDeclaration<Message> =>
  handler.prototype.messageType ?? new handler().messageType

/**
 * Every transport instance a bus has been built with. A transport holds one queue and one connection, so it can
 * only belong to one bus. This holds no message state, and drops transports that are garbage collected.
 */
const TRANSPORTS_IN_USE = new WeakSet<Transport>()

export interface BusInitializeOptions {
  /**
   * If true, will initialize the bus in send only mode.
   * This will provide a bus instance that is capable of sending/publishing
   * messages only and won't handle incoming messages or workflows
   * @default false
   */
  sendOnly: boolean
}

export class BusConfiguration {
  private configuredTransport: Transport | undefined
  private concurrency = 1
  private busInstance: BusInstance | undefined
  private container: ContainerAdapter | undefined
  private workflowRegistry = new WorkflowRegistry()
  private handlerRegistry = new DefaultHandlerRegistry()
  private loggerFactory: LoggerFactory = createDefaultLoggerFactory()
  private serializer: Serializer | undefined
  private persistence: Persistence = new InMemoryPersistence()
  private middleware: BusMiddleware[] = []
  private recoverability: RecoverabilityPolicy = defaultRecoverability()
  private delayedDelivery: Required<DelayedDeliveryOptions> = { dispatch: true }
  private scheduler = false
  private sendOnly = false
  private interruptSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  private receiver: Receiver | undefined
  private messageTypes: MessageTypes[] = []

  /**
   * Constructs an instance of a bus from the configuration
   * @throws BusAlreadyInitialized if the bus has already been built
   * @throws ContainerNotRegistered if a class handler's constructor takes arguments and no container is registered
   * @throws TransportAlreadyInUse if the transport is already used by another bus
   * @throws MessageTypesConflict if the message types passed to `withMessageTypes()` define a `$name` or type
   * differently
   * @throws MessageTypeReferenceNotFound if message types passed to `withMessageTypes()` refer to a type they
   * don't define
   */
  build(): BusInstance {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    if (!this.container) {
      // Without a container class handlers are constructed with no arguments, so fail now rather than on each message
      const classHandlerWithArguments = (
        this.handlerRegistry.getClassHandlers() as unknown as ClassConstructor<Handler>[]
      ).find(classHandler => classHandler.length > 0)
      if (classHandlerWithArguments) {
        throw new ContainerNotRegistered(classHandlerWithArguments.name)
      }
    }

    if (this.scheduler) {
      this.assertSchedulerConfiguration()
    }

    const transport: Transport = this.configuredTransport || new InMemoryQueue()
    if (TRANSPORTS_IN_USE.has(transport)) {
      throw new TransportAlreadyInUse(transport.constructor.name)
    }

    const serializer = this.serializer ?? new JsonSerializer()
    const messageTypes = mergeMessageTypes(this.messageTypes)
    const messageHandlingContext = new MessageHandlingContext()
    const messageLifecycleContext = new MessageLifecycleContext()

    const coreDependencies: CoreDependencies = {
      container: this.container,
      handlerRegistry: this.handlerRegistry,
      loggerFactory: this.loggerFactory,
      serializer,
      messageSerializer: new MessageSerializer(
        serializer,
        this.handlerRegistry,
        messageTypes
      ),
      messageTypes,
      interruptSignals: this.interruptSignals
    }

    // Send-only buses use the persistence too, to store messages sent with deliverAfter or deliverAt
    this.persistence.prepare(coreDependencies)
    if (!this.sendOnly) {
      this.workflowRegistry.prepare(
        coreDependencies,
        this.persistence,
        messageHandlingContext,
        messageLifecycleContext
      )
    }

    transport.prepare(coreDependencies)
    TRANSPORTS_IN_USE.add(transport)

    this.busInstance = new BusInstance(
      transport,
      this.concurrency,
      this.workflowRegistry,
      coreDependencies,
      new MiddlewarePipeline(this.middleware),
      this.handlerRegistry,
      this.container,
      this.sendOnly,
      this.receiver,
      messageHandlingContext,
      messageLifecycleContext,
      this.recoverability,
      this.persistence,
      this.delayedDelivery,
      this.scheduler
    )
    return this.busInstance
  }

  /**
   * Configures the bus as a dedicated scheduler, which only sends the scheduled messages in its persistence once
   * they're due, for every service that uses the same persistence. It doesn't receive: its transport sets up no
   * queue, and `start()` only starts sending scheduled messages. It doesn't need the message types of the messages
   * it sends, since it sends each one as it was stored.
   *
   * Pair it with `withDelayedDelivery({ dispatch: false })` on the services, so only the scheduler sends them.
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * const scheduler = Bus.configure()
   *   .withTransport(transport)
   *   .withPersistence(postgresPersistence)
   *   .asScheduler()
   *   .build()
   * await scheduler.initialize()
   * await scheduler.start()
   */
  asScheduler(): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.scheduler = true
    return this
  }

  /**
   * Checks a bus configured with `asScheduler()` has nothing else to do
   * @throws InvalidOperation if it's also send-only, has dispatching turned off, or has handlers, workflows or a
   * receiver
   */
  private assertSchedulerConfiguration(): void {
    const conflicts: [boolean, string][] = [
      [this.sendOnly, 'asSendOnly()'],
      [
        !this.delayedDelivery.dispatch,
        'withDelayedDelivery({ dispatch: false })'
      ],
      [!!this.receiver, 'withReceiver()'],
      [
        this.handlerRegistry.getMessageNames().length > 0 ||
          this.handlerRegistry.getResolvers().length > 0,
        'withHandler() or withCustomHandler()'
      ],
      [this.workflowRegistry.hasWorkflowsToInitialize(), 'withWorkflow()']
    ]
    const conflict = conflicts.find(([applies]) => applies)
    if (conflict) {
      throw new InvalidOperation(
        `A bus configured with asScheduler() only sends scheduled messages, so it can't also use ${conflict[1]}. Use a separate bus for that.`
      )
    }
  }

  /**
   * Configure the bus to only send messages and not receive them. No queues or subscriptions will be created for
   * this service.
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  asSendOnly(): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.sendOnly = true
    return this
  }

  /**
   * Register a handler for a specific message type. When Bus is initialized it will configure
   * the transport to subscribe to this type of message and upon receipt will forward the message
   * through to the provided message handler
   * @param messageType Which message will be subscribed to and routed to the handler
   * @param messageHandler A callback that will be invoked when the message is received
   * @param customResolver Subscribe to a topic that's created and maintained outside of the application
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withHandler(...classHandler: ClassConstructor<Handler>[]): this
  withHandler<
    MessageType extends Message,
    TMessageAttributes extends MessageAttributes = MessageAttributes
  >(
    ...functionHandler: {
      messageType: MessageDeclaration<MessageType>
      messageHandler: HandlerDefinition<MessageType, TMessageAttributes>
    }[]
  ): this
  withHandler<MessageType extends Message>(
    ...handler:
      | ClassConstructor<Handler>[]
      | {
          messageType: MessageDeclaration<MessageType>
          messageHandler: HandlerDefinition<MessageType>
        }[]
  ): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    for (const handlerToAdd of handler) {
      if ('messageHandler' in handlerToAdd) {
        this.handlerRegistry.register(
          handlerToAdd.messageType,
          handlerToAdd.messageHandler
        )
      } else if (isClassHandler(handlerToAdd)) {
        this.handlerRegistry.register(
          resolveClassHandlerMessageType(handlerToAdd),
          handlerToAdd
        )
      }
    }

    return this
  }

  /**
   * Registers a custom handler that receives messages from external systems, or messages that don't implement the
   * Message interface from @node-ts/bus-messages
   * @param messageHandler A handler that receives the custom message
   * @param customResolver A discriminator that determines if an incoming message should be mapped to this handler.
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withCustomHandler<MessageType>(
    messageHandler: HandlerDefinition<MessageType>,
    customResolver: CustomResolver<MessageType>
  ): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.handlerRegistry.registerCustom(messageHandler, customResolver)
    return this
  }

  /**
   * Register a workflow definition so that all of the messages it depends on will be subscribed to
   * and forwarded to the handlers inside the workflow
   * @param workflow Classes that extend `Workflow`, or workflows declared with `defineWorkflow`
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @throws WorkflowNotRecognized if a workflow is neither a class that extends `Workflow` nor declared with
   * `defineWorkflow`
   * @example
   * Bus.configure().withWorkflow(OrderWorkflow, defineWorkflow(ShippingState).startedBy(OrderPaid, ...))
   */
  withWorkflow(
    ...workflow: (
      | ClassConstructor<Workflow<WorkflowState>>
      | FunctionWorkflow<WorkflowState>
    )[]
  ): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    workflow.forEach(workflowToRegister =>
      this.workflowRegistry.register(workflowToRegister)
    )
    return this
  }

  /**
   * Configures Bus to use a different transport than the default MemoryQueue. A transport instance holds one
   * queue and one connection, so each bus needs its own instance.
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withTransport(transportConfiguration: Transport): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.configuredTransport = transportConfiguration
    return this
  }

  /**
   * Configures Bus to use a different logging provider than the default console logger
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withLogger(loggerFactory: LoggerFactory): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.loggerFactory = loggerFactory
    return this
  }

  /**
   * Configures Bus to use a different serialization provider. The provider is responsible for
   * transforming messages to/from a serialized representation, as well as ensuring all object
   * properties are a strong type. The bus passes its message types (see `withMessageTypes()`) to the
   * serializer each time it restores an object, so one serializer can be shared by several buses.
   * @default JsonSerializer
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withSerializer(serializer: Serializer): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.serializer = serializer
    return this
  }

  /**
   * Gives the bus the message types generated by `bus generate-message-types` (from `@node-ts/bus-cli`), which
   * say how to restore the Dates, Maps, Sets, bigints and classes of each message and workflow state it
   * receives. Pass the `messageTypes` export of every generated file whose messages the bus handles. Calling
   * this again adds to the message types already passed.
   *
   * A bus that receives messages must have message types for every message it handles and every workflow state
   * it persists, or `initialize()` throws `MessageTypesMissing`. Send-only buses don't need them.
   * @param messageTypes the message types of one or more generated files
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * import { messageTypes as orderMessageTypes } from '@my-org/order-messages'
   * import { messageTypes } from './message-types.generated'
   *
   * const bus = Bus.configure()
   *   .withMessageTypes(orderMessageTypes, messageTypes)
   *   .withHandler(orderPlacedHandler)
   *   .build()
   */
  withMessageTypes(...messageTypes: MessageTypes[]): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.messageTypes.push(...messageTypes)
    return this
  }

  /**
   * Configures Bus to use a different persistence provider than the default InMemoryPersistence provider.
   * This stores workflow state, and messages sent with `deliverAfter` or `deliverAt` until they're due. The
   * default `InMemoryPersistence` loses both when the process stops.
   * @default InMemoryPersistence
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * Bus.configure().withPersistence(new PostgresPersistence({ connection, schemaName: 'workflows' }))
   */
  withPersistence(persistence: Persistence): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.persistence = persistence
    return this
  }

  /**
   * Sets the message handling concurrency beyond the default value of 1, which will increase the number of messages
   * handled in parallel.
   * @default 1
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withConcurrency(concurrency: number): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    if (concurrency < 1) {
      throw new Error(
        'Invalid concurrency setting. Must be set to 1 or greater'
      )
    }

    this.concurrency = concurrency
    return this
  }

  /**
   * Use a local dependency injection/IoC container to resolve handlers
   * and workflows.
   * @param container An adapter to an existing DI container to fetch class instances from
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withContainer(container: ContainerAdapter): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.container = container
    return this
  }

  /**
   * Adds middleware to the bus' pipeline. Each `BusMiddleware` can wrap any of three stages:
   * - `incoming`: the handling of each received message, around all of its handlers
   * - `handler`: each call of a handler or workflow handler, inside its outbox
   * - `outgoing`: each `send()` and `publish()`, before the message is buffered or sent, where it can change the
   * attributes or set native transport headers
   *
   * Within each stage, middleware runs in the order it's registered, with the first registered outermost. Calling
   * this again adds to the middleware already registered.
   * @param middleware the middleware to add
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * Bus.configure().withMiddleware({
   *   incoming: async (context, next) => {
   *     const started = Date.now()
   *     await next()
   *     console.log(`${context.message.$name} handled in ${Date.now() - started}ms`)
   *   }
   * })
   */
  withMiddleware(...middleware: BusMiddleware[]): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.middleware.push(...middleware)
    return this
  }

  /**
   * Sets how the bus takes part in delayed delivery. By default every started bus whose persistence stores outgoing
   * messages sends the scheduled messages in it once they're due. Turn `dispatch` off to leave that to another bus on
   * the same persistence, such as a dedicated scheduler, while this bus still schedules messages with `deliverAfter`
   * and `deliverAt`.
   * @param options how the bus takes part in delayed delivery
   * @default { dispatch: true }
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * // A service whose scheduled messages are sent by a dedicated scheduler
   * Bus.configure()
   *   .withPersistence(postgresPersistence)
   *   .withDelayedDelivery({ dispatch: false })
   */
  withDelayedDelivery(options: DelayedDeliveryOptions): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.delayedDelivery = {
      dispatch: options.dispatch ?? this.delayedDelivery.dispatch
    }
    return this
  }

  /**
   * Sets the recoverability policy, which decides what happens each time handling a message fails: retry it after
   * a delay, or move it to the dead letter queue with its failure metadata. Messages failed with `failMessage()`
   * always go to the dead letter queue without consulting it.
   * @param policy a function of the failure that returns `retry(delay)` or `deadLetter()`, such as one built by
   * `defaultRecoverability()`
   * @default defaultRecoverability(), which makes 10 attempts with exponentially growing delays
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * Bus.configure().withRecoverability(
   *   defaultRecoverability({ maxAttempts: 5, delay: 1_000, unrecoverable: [ValidationError] })
   * )
   * @example
   * // A policy of your own
   * Bus.configure().withRecoverability(({ failedAttempts }) =>
   *   failedAttempts < 3 ? retry(500) : deadLetter()
   * )
   */
  withRecoverability(policy: RecoverabilityPolicy): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.recoverability = policy
    return this
  }

  /**
   * Sets the process signals that gracefully stop the bus, replacing the defaults. Pass an empty array to listen
   * for none, so a host such as NestJS or AWS Lambda can own shutdown and call `bus.stop()` or `bus.dispose()` itself.
   * Send-only buses never listen for signals.
   * @param signals The signals that stop the bus
   * @default ['SIGINT', 'SIGTERM']
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * // Let the host handle SIGINT and SIGTERM
   * Bus.configure().withInterruptSignals([])
   * @example
   * // Also stop on SIGUSR2
   * Bus.configure().withInterruptSignals(['SIGINT', 'SIGTERM', 'SIGUSR2'])
   */
  withInterruptSignals(signals: NodeJS.Signals[]): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.interruptSignals = Array.from(new Set(signals))
    return this
  }

  /**
   * Register a receiving mechanism that will be used to receive messages and deliver
   * them to the dispatcher.
   *
   * Usually the bus will connect to a transport and receive messages directly. However
   * a different receiver plugin can be used that will become responsible for this instead.
   *
   * Once the bus is configured, messages can be received by passing the received message into bus.receive().
   *
   * @param receiver The receiver mechanism to use, or `undefined` to use the default behaviour
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withReceiver(receiver: Receiver | undefined): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.receiver = receiver
    return this
  }
}
