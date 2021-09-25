import { Message } from '@node-ts/bus-messages'
import { DefaultHandlerRegistry } from '../handler'
import { Handler } from '../handler/handler'
import { JsonSerializer, Serializer } from '../serialization'
import { MemoryQueue, Transport } from '../transport'
import { ClassConstructor, CoreDependencies } from '../util'
import { BusInstance } from './bus-instance'
import { Persistence, Workflow, WorkflowState } from '../workflow'
import { WorkflowRegistry } from '../workflow/registry/workflow-registry'
import { BusAlreadyInitialized } from './error'
import { ContainerAdapter } from '../container'
import { defaultLoggerFactory, LoggerFactory } from '../logger'
import { ContainerNotRegistered } from '../error'
import { MessageSerializer } from '../serialization/message-serializer'
import { InMemoryPersistence } from '../workflow/persistence'

export enum BusState {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped'
}

export interface BusInitializeOptions {
  /**
   * If true, will initialize the bus in send only mode.
   * This will provide a bus instance that is capable of sending/publishing
   * messages only and won't handle incoming messages or workflows
   * @default false
   */
  sendOnly: boolean
}

const defaultBusInitializeOptions: BusInitializeOptions = {
  sendOnly: false
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

  /**
   * Initializes the bus with the provided configuration
   * @param options Changes the default startup mode of the bus
   */
  async initialize (options = defaultBusInitializeOptions): Promise<BusInstance> {
    const { sendOnly } = options
    const logger = this.loggerFactory('@node-ts/bus-core:bus')
    logger.debug('Initializing bus', { sendOnly })

    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    const coreDependencies: CoreDependencies = {
      container: this.container,
      handlerRegistry: this.handlerRegistry,
      loggerFactory: this.loggerFactory,
      serializer: this.serializer,
      messageSerializer: new MessageSerializer(this.serializer, this.handlerRegistry)
    }

    if (!sendOnly) {
      this.persistence?.prepare(coreDependencies)
      this.workflowRegistry.prepare(coreDependencies, this.persistence)
      await this.workflowRegistry.initialize(this.handlerRegistry, this.container)

      const classHandlers = this.handlerRegistry.getClassHandlers()
      if (!this.container && classHandlers.length) {
        throw new ContainerNotRegistered(classHandlers[0].constructor.name)
      }
    }

    const transport: Transport = this.configuredTransport || new MemoryQueue()
    transport.prepare(coreDependencies)
    if (transport.connect) {
      await transport.connect()
    }
    if (!sendOnly && transport.initialize) {
      await transport.initialize(this.handlerRegistry)
    }
    this.busInstance = new BusInstance(
      transport,
      this.concurrency,
      this.workflowRegistry,
      coreDependencies
    )

    logger.debug('Bus initialized', { sendOnly, registeredMessages: this.handlerRegistry.getMessageNames() })

    return this.busInstance
  }

  /**
   * Register a handler for a specific message type. When Bus is initialized it will configure
   * the transport to subscribe to this type of message and upon receipt will forward the message
   * through to the provided message handler
   * @param messageType Which message will be subscribed to and routed to the handler
   * @param messageHandler A callback that will be invoked when the message is received
   * @param customResolver Subscribe to a topic that's created and maintained outside of the application
   */
  withHandler<MessageType extends (Message | object)> (
    messageType: ClassConstructor<MessageType>,
    messageHandler: Handler<MessageType>
  ): this
  {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.handlerRegistry.register(
      messageType,
      messageHandler
    )
    return this
  }

  withCustomHandler<MessageType extends (Message | object)> (
    messageHandler: Handler<MessageType>,
    customResolver: {
      resolveWith: ((message: MessageType) => boolean),
      topicIdentifier?: string
    }
  ): this
  {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.handlerRegistry.registerCustom(
      messageHandler,
      customResolver
    )
    return this
  }

  /**
   * Register a workflow definition so that all of the messages it depends on will be subscribed to
   * and forwarded to the handlers inside the workflow
   */
  withWorkflow<TWorkflowState extends WorkflowState> (workflow: ClassConstructor<Workflow<TWorkflowState>>): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.workflowRegistry.register(
      workflow
    )
    return this
  }

  /**
   * Configures Bus to use a different transport than the default MemoryQueue
   */
  withTransport (transportConfiguration: Transport): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    this.configuredTransport = transportConfiguration
    return this
  }

  /**
   * Configures Bus to use a different logging provider than the default console logger
   */
  withLogger (loggerFactory: LoggerFactory): this {
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
  withSerializer (serializer: Serializer): this {
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
  withPersistence (persistence: Persistence): this {
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
  withConcurrency (concurrency: number): this {
    if (concurrency < 1) {
      throw new Error('Invalid concurrency setting. Must be set to 1 or greater')
    }

    this.concurrency = concurrency
    return this
  }

  /**
   * Use a local dependency injection/IoC container to resolve handlers
   * and workflows.
   * @param container An adapter to an existing DI container to fetch class instances from
   */
  withContainer (container: { get <T>(type: ClassConstructor<T>): T }): this {
    this.container = container
    return this
  }
}

export class Bus {
  private constructor () {
  }

  /**
   * Configures the Bus prior to use
   */
  static configure (): BusConfiguration {
    return new BusConfiguration()
  }
}
