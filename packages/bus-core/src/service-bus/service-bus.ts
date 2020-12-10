import { Transport } from '../transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { sleep } from '../util'
import { handlerRegistry, HandlerRegistration } from '../handler'
import * as serializeError from 'serialize-error'
// import { SessionScopeBinder } from '../bus-module'
import { getLogger } from './logger'

const EMPTY_QUEUE_SLEEP_MS = 500

export enum BusState {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped'
}

export class ServiceBus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0

  constructor (
    private readonly transport: Transport<{}>
    // @inject(BUS_SYMBOLS.MessageHandlingContext) private readonly messageHandlingContext: MessageAttributes
  ) {
  }

  async publish<TEvent extends Event> (
    event: TEvent,
    messageOptions: Partial<MessageAttributes> = new MessageAttributes()
  ): Promise<void> {
    getLogger().debug('publish', { event })
    const transportOptions = this.prepareTransportOptions(messageOptions)
    return this.transport.publish(event, transportOptions)
  }

  async send<TCommand extends Command> (
    command: TCommand,
    messageOptions: Partial<MessageAttributes> = new MessageAttributes()
  ): Promise<void> {
    getLogger().debug('send', { command })
    const transportOptions = this.prepareTransportOptions(messageOptions)
    return this.transport.send(command, transportOptions)
  }

  async start (): Promise<void> {
    if (this.internalState !== BusState.Stopped) {
      throw new Error('ServiceBus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    getLogger().info('ServiceBus starting...')
    this.internalState = BusState.Started
    setTimeout(async () => this.applicationLoop(), 0)
  }

  async stop (): Promise<void> {
    this.internalState = BusState.Stopping
    getLogger().info('ServiceBus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }

    this.internalState = BusState.Stopped
    getLogger().info('ServiceBus stopped')
  }

  async dispose (): Promise<void> {
    await this.stop()
    if (this.transport.dispose) {
      await this.transport.dispose()
    }
  }

  get state (): BusState {
    return this.internalState
  }

  private async applicationLoop (): Promise<void> {
    this.runningWorkerCount++
    while (this.internalState === BusState.Started) {
      const messageHandled = await this.handleNextMessage()

      // Avoids locking up CPU when there's no messages to be processed
      if (!messageHandled) {
        await sleep(EMPTY_QUEUE_SLEEP_MS)
      }
    }
    this.runningWorkerCount--
  }

  private async handleNextMessage (): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()

      if (message) {
        getLogger().debug('Message read from transport', { message })

        try {
          await this.dispatchMessageToHandlers(message.domainMessage, message.attributes)
          getLogger().debug('Message dispatched to all handlers', { message })
          await this.transport.deleteMessage(message)
        } catch (error) {
          getLogger().warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializeError(error) }
          )
          await this.transport.returnMessage(message)
          return false
        }
        return true
      }
    } catch (error) {
      getLogger().error('Failed to receive message from transport', { error: serializeError(error) })
    }
    return false
  }

  private async dispatchMessageToHandlers (message: Message, context: MessageAttributes): Promise<void> {
    const handlers = handlerRegistry.get(message.$name)
    if (handlers.length === 0) {
      getLogger().warn(`No handlers registered for message ${message.$name}. Message will be discarded`)
      return
    }

    const handlersToInvoke = handlers.map(handler => dispatchMessageToHandler(
      message,
      context,
      handler
    ))

    await Promise.all(handlersToInvoke)
  }

  private prepareTransportOptions (clientOptions: Partial<MessageAttributes>): MessageAttributes {
    const result: MessageAttributes = {
      correlationId: clientOptions.correlationId || this.messageHandlingContext.correlationId,
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...clientOptions.stickyAttributes,
        ...this.messageHandlingContext.stickyAttributes
      }
    }

    return result
  }
}

async function dispatchMessageToHandler (
  message: Message,
  context: MessageAttributes,
  handlerRegistration: HandlerRegistration<Message>
): Promise<void> {
  const container = handlerRegistration.defaultContainer
  const childContainer = container.createChild()

  childContainer
    .bind<MessageAttributes>(BUS_SYMBOLS.MessageHandlingContext)
    .toConstantValue(context)

  const sessionScopeBinder = container.get<SessionScopeBinder>(BUS_INTERNAL_SYMBOLS.SessionScopeBinder)
  // tslint:disable-next-line:no-unsafe-any
  sessionScopeBinder(childContainer.bind.bind(childContainer))

  const handler = handlerRegistration.resolveHandler(childContainer)
  return handler.handle(message, context)
}
