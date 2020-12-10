import { Command, Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { Logger } from '@node-ts/logger-core'
import { handlerRegistry } from '../handler'
import { Handler, HandlerPrototype } from '../handler/handler'
import { Serializer } from '../serialization'
import { MemoryQueue, Transport } from '../transport'
import { ClassConstructor } from '../util'
import { setLogger } from './logger'
import { ServiceBus } from './service-bus'

let serviceBus: ServiceBus | undefined
const getServiceBus = () => {
  if (!serviceBus) {
    throw new Error('Bus has not been initialized, call `await .initialize()`')
  }

  return serviceBus
}

class BusConfiguration {

  private configuredTransport: Transport | undefined

  async initialize (): Promise<void> {
    const transport = this.configuredTransport || new MemoryQueue()
    if (transport.initialize) {
      await transport.initialize(handlerRegistry)
    }
    serviceBus = new ServiceBus(transport)
  }

  withHandler<MessageType extends Message> (
    messageType: ClassConstructor<MessageType>,
    messageHandler: ClassConstructor<Handler<Message>>
  ): this {
    if (!!serviceBus) {
      throw new Error('Cannot call registerHandler() after initialize() has been called')
    }

    const prototype = messageHandler.prototype as HandlerPrototype
    if (!prototype.$symbol) {
      throw new Error(
        `Missing symbol on ${prototype.constructor}.`
        + 'This could mean the handler class is missing the @Handles() decorator.'
      )
    }

    if (!prototype.$messageName) {
      throw new Error(
        `Missing message type on ${prototype.constructor}.`
        + 'This could mean the handler class is missing the @Handles() decorator.'
      )
    }

    handlerRegistry.register(
      prototype.$messageName,
      prototype.$symbol,
      messageHandler,
      prototype.$message
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
}
