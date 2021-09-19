import { Message } from '@node-ts/bus-messages'
import { handlerRegistry } from '../handler'
import { Handler } from '../handler/handler'
import { Serializer, setSerializer } from '../serialization'
import { MemoryQueue, Transport } from '../transport'
import { ClassConstructor } from '../util'
import { BusInstance } from './bus-instance'
import { Persistence, Workflow, WorkflowState } from '../workflow'
import { WorkflowRegistry } from '../workflow/registry/workflow-registry'
import { setPersistence } from '../workflow/persistence/persistence'
import { BusAlreadyInitialized } from './error'
import { ContainerAdapter } from '../container'
import { getLogger, LoggerFactory, setLogger } from '../logger'
import { ContainerNotRegistered } from '../error'

const logger = getLogger('@node-ts/bus-core:bus')

export enum BusState {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped'
}

export class BusConfiguration {

  private configuredTransport: Transport | undefined
  private concurrency = 1
  private busInstance: BusInstance | undefined
  private container: ContainerAdapter | undefined
  private workflowRegistry = new WorkflowRegistry()

  /**
   * Initializes the bus with the provided configuration
   */
  async initialize (): Promise<BusInstance> {
    logger.debug('Initializing bus')

    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    await this.workflowRegistry.initialize(this.container)

    const classHandlers = handlerRegistry.getClassHandlers()
    if (!this.container && classHandlers.length) {
      throw new ContainerNotRegistered(classHandlers[0].constructor.name)
    }

    const transport = this.configuredTransport || new MemoryQueue()
    if (transport.initialize) {
      await transport.initialize(handlerRegistry)
    }
    this.busInstance = new BusInstance(
      transport,
      this.concurrency,
      this.workflowRegistry,
      this.container
    )

    logger.debug('Bus initialized', { registeredMessages: handlerRegistry.getMessageNames() })

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

    handlerRegistry.register(
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

    handlerRegistry.registerCustom(
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
  withLogger (loggerConfiguration: LoggerFactory): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    setLogger(loggerConfiguration)
    return this
  }

  /**
   * Configures Bus to use a different serialization provider. The provider is responsible for
   * transforming messages to/from a serialized representation, as well as ensuring all object
   * properties are a strong type
   */
  withSerializer (serializerConfiguration: Serializer): this {
    if (!!this.busInstance) {
      throw new BusAlreadyInitialized()
    }

    setSerializer(serializerConfiguration)
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

    setPersistence(persistence)
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
