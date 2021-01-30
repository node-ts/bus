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

  async initialize (): Promise<void> {
    await workflowRegistry.initialize()

    const transport = this.configuredTransport || new MemoryQueue()
    if (transport.initialize) {
      await transport.initialize(handlerRegistry)
    }
    serviceBus = new ServiceBus(transport, this.concurrency)
  }

  withHandler<MessageType extends Message> (
    messageType: ClassConstructor<MessageType>,
    messageHandler: Handler<MessageType>
  ): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    handlerRegistry.register(
      messageType,
      messageHandler
    )
    return this
  }

  withWorkflow<TWorkflowState extends WorkflowState> (workflow: Workflow<TWorkflowState>): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    workflowRegistry.register(
      workflow
    )
    return this
  }

  withTransport (transportConfiguration: Transport): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    this.configuredTransport = transportConfiguration
    return this
  }

  withLogger (loggerConfiguration: Logger): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    setLogger(loggerConfiguration)
    return this
  }

  withSerializer (serializerConfiguration: Serializer): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    setSerializer(serializerConfiguration)
    return this
  }

  withPersistence (persistence: Persistence): this {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }

    setPersistence(persistence)
    return this
  }

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

  static configure (): BusConfiguration {
    if (!!serviceBus) {
      throw new BusAlreadyInitialized()
    }
    return new BusConfiguration()
  }

  static async publish<EventType extends Event> (event: EventType, messageOptions?: MessageAttributes): Promise<void> {
    return getServiceBus().publish(event,  messageOptions)
  }

  static async send<CommandType extends Command> (command: CommandType, messageOptions?: MessageAttributes): Promise<void> {
    return getServiceBus().send(command,  messageOptions)
  }

  static async start (): Promise<void> {
    return getServiceBus().start()
  }

  static async stop (): Promise<void> {
    return getServiceBus().stop()
  }

  static async dispose (): Promise<void> {
    return getServiceBus().dispose()
  }

  static get state(): BusState {
    return getServiceBus().state
  }
}
