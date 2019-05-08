import { injectable, inject } from 'inversify'
import { Transport } from './transport'
import { Event, Command, Message } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { HandlerRegistry } from '../handler'

export const RETRY_LIMIT = 10

export interface InMemoryMessage {
  /**
   * If the message is currently being handled and not visible to other consumers
   */
  inFlight: boolean

  /**
   * The number of times the message has been fetched from the queue
   */
  seenCount: number

  /**
   * The body of the message that was sent by the consumer
   */
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
  private deadLetterQueue: TransportMessage<InMemoryMessage>[] = []
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
    message.raw.seenCount++

    if (message.raw.seenCount >= RETRY_LIMIT) {
      // Message retries exhausted, send to DLQ
      this.logger.info('Message retry limit exceeded, sending to dead letter queue', { message })
      await this.sendToDeadLetterQueue(message)
    } else {
      message.raw.inFlight = false
    }
  }

  get depth (): number {
    return this.queue.length
  }

  get deadLetterQueueDepth (): number {
    return this.deadLetterQueue.length
  }

  private async sendToDeadLetterQueue (message: TransportMessage<InMemoryMessage>): Promise<void> {
    this.deadLetterQueue.push(message)
    await this.deleteMessage(message)
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
      seenCount: 0,
      payload: message,
      inFlight: isProcessing
    }
  }
}
