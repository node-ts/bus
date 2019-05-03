import { injectable, inject } from 'inversify'
import { Transport } from './transport'
import { Event, Command, Message } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { HandlerRegistry } from '../handler'

export interface InMemoryMessage {
  inFlight: boolean
  payload: Message
}

/**
 * An in-memory message queue. This isn't intended for production use as all messages
 * are kept in memory and hence will be wiped when the application or host restarts.
 *
 * There are however legitimate uses for in-memory queues such as decoupling of non-mission
 * critical code inside of larger applications; so use at your own discresion.
 */
@injectable()
export class MemoryQueue implements Transport<InMemoryMessage> {

  private queue: TransportMessage<InMemoryMessage>[] = []
  private messagesWithHandlers: { [key: string]: {} }

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  async initialize (handlerRegistry: HandlerRegistry): Promise<void> {
    this.messagesWithHandlers = {}
    handlerRegistry.getMessageNames()
      .forEach(messageName => this.messagesWithHandlers[messageName] = {})
  }

  async dispose (): Promise<void> {
    if (this.queue.length > 0) {
      this.logger.warn('Memory queue being shut down, all messages will be lost.', { queueSize: this.queue.length})
    }
  }

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    this.addToQueue(event)
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    this.addToQueue(command)
  }

  async readNextMessage (): Promise<TransportMessage<InMemoryMessage> | undefined> {
    this.logger.debug('Reading next message', { queueSize: this.queue.length })
    const availableMessages = this.queue.filter(m => !m.raw.inFlight)

    if (availableMessages.length === 0) {
      this.logger.debug('No messages available in queue')
      return undefined
    }

    const message = availableMessages[0]
    message.raw.inFlight = true
    return message
  }

  async deleteMessage (message: TransportMessage<InMemoryMessage>): Promise<void> {
    const messageIndex = this.queue.indexOf(message)
    this.logger.debug('Deleting message', { queueDepth: this.depth, messageIndex })
    this.queue.splice(messageIndex, 1)
    this.logger.debug('Message Deleted', { queueDepth: this.depth })
  }

  async returnMessage (message: TransportMessage<InMemoryMessage>): Promise<void> {
    message.raw.inFlight = false
  }

  get depth (): number {
    return this.queue.length
  }

  private addToQueue (message: Message): void {
    if (this.messagesWithHandlers[message.$name]) {
      const transportMessage = toTransportMessage(message, false)
      this.queue.push(transportMessage)
      this.logger.debug('Added message to queue', { message, queueSize: this.queue.length })
    } else {
      this.logger.warn('Message was not sent as it has no registered handlers', { message })
    }
  }
}

function toTransportMessage (message: Message, isProcessing: boolean): TransportMessage<InMemoryMessage> {
  return {
    id: undefined,
    domainMessage: message,
    raw: {
      payload: message,
      inFlight: isProcessing
    }
  }
}
