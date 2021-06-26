import { Command, Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { handlerRegistry } from '../handler'
import { Handler } from '../handler/handler'
import { Serializer, setSerializer } from '../serialization'
import { MemoryQueue, Transport } from '../transport'
import { ClassConstructor, setLogger, Logger } from '../util'
import { ServiceBus } from './service-bus'
import { Persistence, Workflow, WorkflowState } from '../workflow'
import { workflowRegistry } from '../workflow/registry/workflow-registry'
import { setPersistence } from '../workflow/persistence/persistence'
import { BusAlreadyInitialized, BusNotInitialized } from './error'
import { HookAction, HookCallback } from './bus-hooks'

let serviceBus: ServiceBus | undefined
const getServiceBus = () => {
  if (!serviceBus) {
    throw new BusNotInitialized()
  }

  return serviceBus
}

export enum BusState {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped'
}

class BusConfiguration {

  private configuredTransport: Transport | undefined
  private concurrency = 1

  /**
   * Initializes the bus with the provided configuration
   */
  async initialize (): Promise<void> {
    await workflowRegistry.initialize()

    const transport = this.configuredTransport || new MemoryQueue()
    if (transport.initialize) {
      await transport.initialize(handlerRegistry)
    }
    serviceBus = new ServiceBus(transport, this.concurrency)
  }

  /**
   * Register a handler for a specific message type. When Bus is initialized it will configure
   * the transport to subscribe to this type of message and upon receipt will forward the message
   * through to the provided message handler
   * @param messageType Which message will be subscribed to and routed to the handler
   * @param messageHandler A callback that will be invoked when the message is received
   * @param customResolver Subscribe to a topic that's created and maintained outside of the application
   */
  withHandler<MessageType extends Message> (
    messageType: ClassConstructor<MessageType>,
    messageHandler: Handler<MessageType>,
    customResolver?: {
      resolveWith: ((message: Message) => boolean),
      topicIdentifier?: string
    }
  ): this
  {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    handlerRegistry.register(
      messageType,
      messageHandler,
      customResolver?.resolveWith,
      customResolver?.topicIdentifier
    )
    return this
  }

  /**
   * Register a workflow definition so that all of the messages it depends on will be subscribed to
   * and forwarded to the handlers inside the workflow
   */
  withWorkflow<TWorkflowState extends WorkflowState> (workflow: Workflow<TWorkflowState>): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    workflowRegistry.register(
      workflow
    )
    return this
  }

  /**
   * Configures Bus to use a different transport than the default MemoryQueue
   */
  withTransport (transportConfiguration: Transport): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    this.configuredTransport = transportConfiguration
    return this
  }

  /**
   * Configures Bus to use a different logging provider than the default console logger
   */
  withLogger (loggerConfiguration: Logger): this {
    if (!!serviceBus) {
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
    if (!!serviceBus) {
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
    if (!!serviceBus) {
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
}

export class Bus {
  private constructor () {
  }

  /**
   * Configures the Bus prior to use
   */
  static configure (): BusConfiguration {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }
    return new BusConfiguration()
  }

  /**
   * Publishes an event onto the bus. Any subscribers of this event will receive a copy of it.
   */
  static async publish<EventType extends Event> (event: EventType, messageOptions?: Partial<MessageAttributes>): Promise<void> {
    return getServiceBus().publish(event, messageOptions)
  }

  /**
   * Sends a command onto the bus. There should be exactly one subscriber of this command type who can
   * process it and perform the requested action.
   */
  static async send<CommandType extends Command> (command: CommandType, messageOptions?: Partial<MessageAttributes>): Promise<void> {
    return getServiceBus().send(command, messageOptions)
  }

  /**
   * Immediately fail the message of the current receive context and deliver it to the dead letter queue
   * (if configured). It will not be retried Any processing of the message by a different handler on the
   * same service instance will still process it.
   */
  static async fail (): Promise<void> {
    return getServiceBus().fail()
  }

  /**
   * For applications that handle messages, start reading messages off the underlying queue and process them.
   */
  static async start (): Promise<void> {
    return getServiceBus().start()
  }

  /**
   * For applications that handle messages, stop reading messages from the underlying queue.
   */
  static async stop (): Promise<void> {
    return getServiceBus().stop()
  }

  /**
   * Stops the Bus and releases any connections from the underlying queue transport
   */
  static async dispose (): Promise<void> {
    if (serviceBus) {
      await getServiceBus().dispose()
      serviceBus = undefined
    }
  }

  /**
   * Get the current message handling state of the Bus
   */
  static get state(): BusState {
    return getServiceBus().state
  }

  /**
   * Registers a @param callback function that is invoked for every instance of @param action occurring
   * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
   */
  static on<TransportMessageType = unknown> (action: HookAction, callback: HookCallback<TransportMessageType>): void {
    return getServiceBus().on(action, callback)
  }

  /**
   * Deregisters a @param callback function from firing when an @param action occurs
   * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
   */
  static off<TransportMessageType = unknown> (action: HookAction, callback: HookCallback<TransportMessageType>): void {
    return getServiceBus().off(action, callback)
  }
}
