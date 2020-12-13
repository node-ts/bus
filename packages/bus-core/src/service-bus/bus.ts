import { Command, Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { handlerRegistry } from '../handler'
import { Handler } from '../handler/handler'
import { Serializer } from '../serialization'
import { MemoryQueue, Transport } from '../transport'
import { ClassConstructor, setLogger, Logger } from '../util'
import { ServiceBus } from './service-bus'
import { Workflow } from '../workflow'
import { workflowRegistry } from '../workflow/registry/workflow-registry'

let serviceBus: ServiceBus | undefined
const getServiceBus = () => {
  if (!serviceBus) {
    throw new Error('Bus has not been initialized, call `await .initialize()`')
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

  async initialize (): Promise<void> {
    const transport = this.configuredTransport || new MemoryQueue()
    if (transport.initialize) {
      await transport.initialize(handlerRegistry)
    }
    serviceBus = new ServiceBus(transport)
    await workflowRegistry.initialize()
  }

  withHandler<MessageType extends Message> (
    messageType: ClassConstructor<MessageType>,
    messageHandler: Handler<MessageType>
  ): this {
    if (!!serviceBus) {
      throw new Error('Cannot call registerHandler() after initialize() has been called')
    }

    handlerRegistry.register(
      messageType,
      messageHandler
    )
    return this
  }

  withWorkflow (workflow: Workflow): this {
    workflowRegistry.register(
      workflow
    )
    return this
  }

  withTransport (transportConfiguration: Transport): this {
    this.configuredTransport = transportConfiguration
    return this
  }

  withLogger (loggerConfiguration: Logger): this {
    setLogger(loggerConfiguration)
    return this
  }

  withSerializer (serializerConfiguration: Serializer): this {
    return this
  }
}

export class Bus {
  private constructor () {
  }

  static configure (): BusConfiguration {
    if (!!serviceBus) {
      throw new Error('Bus has already been configured')
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
