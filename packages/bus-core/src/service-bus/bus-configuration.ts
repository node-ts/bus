import { MessageTypes } from '@node-ts/bus-messages'
import { ContainerAdapter } from '../container'
import { ContainerNotRegistered } from '../error'
import { CustomResolver, DefaultHandlerRegistry, Handler } from '../handler'
import {
  HandlerDefinition,
  MessageBase,
  isClassHandler
} from '../handler/handler'
import { LoggerFactory, defaultLoggerFactory } from '../logger'
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
import {
  BusAlreadyInitialized,
  MessageTypesWithCustomSerializer
} from './error'

/**
 * Gets the message type a class handler handles. A `messageType` getter is read from the prototype without
 * constructing the handler. A `messageType` class field only exists on instances, so for backwards compatibility
 * the handler is constructed without its dependencies just to read it.
 */
const resolveClassHandlerMessageType = (
  handler: ClassConstructor<Handler>
): ClassConstructor<MessageBase> =>
  handler.prototype.messageType ?? new handler().messageType

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
  private loggerFactory: LoggerFactory = defaultLoggerFactory
  private serializer: Serializer | undefined
  private messageTypes: MessageTypes | undefined
  private persistence: Persistence = new InMemoryPersistence()
  private messageReadMiddlewares = new MiddlewareDispatcher<
    TransportMessage<any>
  >()
  private retryStrategy: RetryStrategy = new DefaultRetryStrategy()
  private sendOnly = false
  private interruptSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  private receiver: Receiver | undefined

  /**
   * Constructs an instance of a bus from the configuration
   * @throws BusAlreadyInitialized if the bus has already been built
   * @throws ContainerNotRegistered if class handlers are registered without a container
   * @throws MessageTypesWithCustomSerializer if both `withMessageTypes()` and `withSerializer()` were used
   * @throws MessageTypeReferenceNotFound if the message types refer to a type they don't define
   */
  build(): BusInstance {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    const classHandlers = this.handlerRegistry.getClassHandlers()
    if (!this.container && classHandlers.length) {
      throw new ContainerNotRegistered(classHandlers[0].constructor.name)
    }

    if (this.serializer && this.messageTypes) {
      throw new MessageTypesWithCustomSerializer()
    }
    const serializer = this.serializer ?? new JsonSerializer(this.messageTypes)

    const coreDependencies: CoreDependencies = {
      container: this.container,
      handlerRegistry: this.handlerRegistry,
      loggerFactory: this.loggerFactory,
      serializer,
      messageSerializer: new MessageSerializer(
        serializer,
        this.handlerRegistry
      ),
      messageTypes: this.messageTypes,
      retryStrategy: this.retryStrategy,
      interruptSignals: this.interruptSignals
    }

    if (!this.sendOnly) {
      this.persistence?.prepare(coreDependencies)
      this.workflowRegistry.prepare(coreDependencies, this.persistence)
    }

    const transport: Transport = this.configuredTransport || new InMemoryQueue()
    transport.prepare(coreDependencies)

    this.busInstance = new BusInstance(
      transport,
      this.concurrency,
      this.workflowRegistry,
      coreDependencies,
      this.messageReadMiddlewares,
      this.handlerRegistry,
      this.container,
      this.sendOnly,
      this.receiver
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
  withHandler<MessageType extends MessageBase>(
    ...functionHandler: {
      messageType: ClassConstructor<MessageType>
      messageHandler: HandlerDefinition<MessageType>
    }[]
  ): this
  withHandler<MessageType extends MessageBase>(
    ...handler:
      | ClassConstructor<Handler>[]
      | {
          messageType: ClassConstructor<MessageType>
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
   * Configures Bus to use a different transport than the default MemoryQueue
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
   * properties are a strong type. It can't be combined with `withMessageTypes()`, which configures
   * the default serializer.
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
   * Registers the message types generated by `bus generate-message-types` (from `@node-ts/bus-cli`), so the
   * default serializer restores Dates, Maps, Sets, bigints and class instances at any depth of the messages
   * and workflow state it reads. Without them, only the top-level class of a message is restored.
   *
   * `initialize()` then throws `MessageTypesMissing` if a handled message or a workflow state has no
   * entry, which usually means the generated file is out of date.
   * @param messageTypes the message types exported by the generated file
   * @default undefined
   * @throws BusAlreadyInitialized if called after the bus has been built
   * @example
   * import { messageTypes } from '@my-org/messages'
   *
   * const bus = Bus.configure()
   *   .withMessageTypes(messageTypes)
   *   .withHandler(handlerFor(PlaceOrder, placeOrder))
   *   .build()
   */
  withMessageTypes(messageTypes: MessageTypes): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.messageTypes = messageTypes
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
