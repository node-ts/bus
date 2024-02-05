import { ContainerAdapter } from '../container'
import { ContainerNotRegistered } from '../error'
import { CustomResolver, DefaultHandlerRegistry, Handler } from '../handler'
import {
  HandlerDefinition,
  MessageBase,
  isClassHandler
} from '../handler/handler'
import { LoggerFactory, defaultLoggerFactory } from '../logger'
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
import { BusAlreadyInitialized } from './error'

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
  private serializer = new JsonSerializer()
  private persistence: Persistence = new InMemoryPersistence()
  private messageReadMiddlewares = new MiddlewareDispatcher<
    TransportMessage<any>
  >()
  private retryStrategy: RetryStrategy = new DefaultRetryStrategy()
  private sendOnly = false
  private interruptSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

  /**
   * Constructs an instance of a bus from the configuration
   */
  build(): BusInstance {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    const classHandlers = this.handlerRegistry.getClassHandlers()
    if (!this.container && classHandlers.length) {
      throw new ContainerNotRegistered(classHandlers[0].constructor.name)
    }

    const coreDependencies: CoreDependencies = {
      container: this.container,
      handlerRegistry: this.handlerRegistry,
      loggerFactory: this.loggerFactory,
      serializer: this.serializer,
      messageSerializer: new MessageSerializer(
        this.serializer,
        this.handlerRegistry
      ),
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
      this.sendOnly
    )
    return this.busInstance
  }

  /**
   * Configure the bus to only send messages and not receive them. No queues or subscriptions will be created for
   * this service.
   */
  asSendOnly(): this {
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
      } else if ('messageResolver' in handlerToAdd) {
      } else if (isClassHandler(handlerToAdd)) {
        const handlerInstance = new handlerToAdd()
        this.handlerRegistry.register(handlerInstance.messageType, handlerToAdd)
      }
    }

    return this
  }

  /**
   * Registers a custom handler that receives messages from external systems, or messages that don't implement the
   * Message interface from @node-ts/bus-messages
   * @param messageHandler A handler that receives the custom message
   * @param customResolver A discriminator that determines if an incoming message should be mapped to this handler.
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
   * properties are a strong type
   */
  withSerializer(serializer: Serializer): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.serializer = serializer
    return this
  }

  /**
   * Configures Bus to use a different persistence provider than the default InMemoryPersistence provider.
   * This is used to persist workflow data and is unused if not using workflows.
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
   */
  withConcurrency(concurrency: number): this {
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
   */
  withContainer(container: ContainerAdapter): this {
    this.container = container
    return this
  }

  /**
   * Register optional middlewares that will run for each message that is polled from the transport
   * Note these middlewares only run when polling successfully pulls a message off the Transports queue
   * After all the user defined middlewares have registered.
   */
  withMessageReadMiddleware<TransportMessageType = unknown>(
    messageReadMiddleware: Middleware<TransportMessage<TransportMessageType>>
  ): this {
    this.messageReadMiddlewares.use(messageReadMiddleware)
    return this
  }

  /**
   * Configure @node-ts/bus to use a different retry strategy that determines delays between
   * retrying failed messages.
   * @default DefaultRetryStrategy
   */
  withRetryStrategy(retryStrategy: RetryStrategy): this {
    this.retryStrategy = retryStrategy
    return this
  }

  /**
   * Register additional signals that will cause the bus to gracefully shutdown
   * @default [SIGINT, SIGTERM]
   */
  withAdditionalInterruptSignal(...signals: NodeJS.Signals[]): this {
    this.interruptSignals = Array.from(
      new Set([...this.interruptSignals, ...signals])
    )
    return this
  }
}
