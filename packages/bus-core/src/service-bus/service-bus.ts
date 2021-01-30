import { Transport } from '../transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { sleep, getLogger} from '../util'
import { Handler, handlerRegistry } from '../handler'
import * as serializeError from 'serialize-error'
import { BusState } from './bus'
import { messageHandlingContext } from './message-handling-context'
const EMPTY_QUEUE_SLEEP_MS = 500

export class ServiceBus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0

  constructor (
    private readonly transport: Transport<{}>,
    private readonly concurrency: number
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
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new Error('ServiceBus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    getLogger().info('ServiceBus starting...')
    messageHandlingContext.enable()

    this.internalState = BusState.Started
    for (var i = 0; i < this.concurrency; i++) {
      setTimeout(async () => this.applicationLoop(), 0)
    }
  }

  async stop (): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new Error('Bus must be started before it can be stopped')
    }
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
          messageHandlingContext.set(message)

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
      getLogger().error(`No handlers registered for message. Message will be discarded`, { messageName: message.$name })
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
    const handlingContext = messageHandlingContext.get()

    const result: MessageAttributes = {
      // The optional operator? decided not to work here
      correlationId: (handlingContext ? handlingContext.attributes.correlationId : undefined) || clientOptions.correlationId,
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...(handlingContext ? handlingContext.attributes.stickyAttributes : {}),
        ...clientOptions.stickyAttributes
      }
    }

    return result
  }
}

async function dispatchMessageToHandler (
  message: Message,
  context: MessageAttributes,
  handler: Handler<Message>
): Promise<void> {
  return handler({
    message,
    context
  })
}
