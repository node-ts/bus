import {
  Message,
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
import { Receiver } from '../receiver'
import { DefaultRetryStrategy, RetryStrategy } from '../retry-strategy'
import { JsonSerializer, Serializer } from '../serialization'
import { MessageSerializer } from '../serialization/message-serializer'
import { InMemoryQueue, Transport, TransportMessage } from '../transport'
import {
  ClassConstructor,
  CoreDependencies,
  Middleware,
  MiddlewareDispatcher
} from '../util'
import { Persistence, Workflow, WorkflowState } from '../workflow'
import { InMemoryPersistence } from '../workflow/persistence'
import { WorkflowRegistry } from '../workflow/registry/workflow-registry'
import { BusInstance } from './bus-instance'
import { BusAlreadyInitialized, TransportAlreadyInUse } from './error'

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
  private messageReadMiddlewares = new MiddlewareDispatcher<
    TransportMessage<any>
  >()
  private retryStrategy: RetryStrategy = new DefaultRetryStrategy()
  private sendOnly = false
  private interruptSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  private receiver: Receiver | undefined
  private messageTypes: MessageTypes[] = []

  /**
   * Constructs an instance of a bus from the configuration
   * @throws BusAlreadyInitialized if the bus has already been built
   * @throws ContainerNotRegistered if class handlers are registered without a container
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

    const classHandlers = this.handlerRegistry.getClassHandlers()
    if (!this.container && classHandlers.length) {
      throw new ContainerNotRegistered(classHandlers[0].constructor.name)
    }

    const transport: Transport = this.configuredTransport || new InMemoryQueue()
    if (TRANSPORTS_IN_USE.has(transport)) {
      throw new TransportAlreadyInUse(transport.constructor.name)
    }

    const serializer = this.serializer ?? new JsonSerializer()
    const messageTypes = mergeMessageTypes(this.messageTypes)
    const messageHandlingContext = new MessageHandlingContext()

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
      retryStrategy: this.retryStrategy,
      interruptSignals: this.interruptSignals
    }

    if (!this.sendOnly) {
      this.persistence?.prepare(coreDependencies)
      this.workflowRegistry.prepare(
        coreDependencies,
        this.persistence,
        messageHandlingContext
      )
    }

    transport.prepare(coreDependencies)
    TRANSPORTS_IN_USE.add(transport)

    this.busInstance = new BusInstance(
      transport,
      this.concurrency,
      this.workflowRegistry,
      coreDependencies,
      this.messageReadMiddlewares,
      this.handlerRegistry,
      this.container,
      this.sendOnly,
      this.receiver,
      messageHandlingContext
    )
    return this.busInstance
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
  withHandler<MessageType extends Message>(
    ...functionHandler: {
      messageType: MessageDeclaration<MessageType>
      messageHandler: HandlerDefinition<MessageType>
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
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withWorkflow<TWorkflowState extends WorkflowState>(
    ...workflow: ClassConstructor<Workflow<TWorkflowState>>[]
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
   * This is used to persist workflow data and is unused if not using workflows.
   * @throws BusAlreadyInitialized if called after the bus has been built
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
   * Register optional middlewares that will run for each message that is polled from the transport
   * Note these middlewares only run when polling successfully pulls a message off the Transports queue
   * After all the user defined middlewares have registered.
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withMessageReadMiddleware<TransportMessageType = unknown>(
    messageReadMiddleware: Middleware<TransportMessage<TransportMessageType>>
  ): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.messageReadMiddlewares.use(messageReadMiddleware)
    return this
  }

  /**
   * Configure @node-ts/bus to use a different retry strategy that determines delays between
   * retrying failed messages.
   * @default DefaultRetryStrategy
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withRetryStrategy(retryStrategy: RetryStrategy): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.retryStrategy = retryStrategy
    return this
  }

  /**
   * Register additional signals that will cause the bus to gracefully shutdown
   * @default [SIGINT, SIGTERM]
   * @throws BusAlreadyInitialized if called after the bus has been built
   */
  withAdditionalInterruptSignal(...signals: NodeJS.Signals[]): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.interruptSignals = Array.from(
      new Set([...this.interruptSignals, ...signals])
    )
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
