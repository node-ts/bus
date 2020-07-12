import { injectable, inject } from 'inversify'
import { Transport } from './transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { HandlerRegistry } from '../handler'
import { MessageType } from '../handler/handler'
import { BUS_SYMBOLS } from '../bus-symbols'
import { EventEmitter } from 'events'

export const RETRY_LIMIT = 10

/**
 * How long to wait for the next message
 */
export const RECEIVE_TIMEOUT_MS = 10000

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
  payload: MessageType
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
  private queuePushed: EventEmitter = new EventEmitter()
  private deadLetterQueue: TransportMessage<InMemoryMessage>[] = []
  private messagesWithHandlers: { [key: string]: {} }

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.HandlerRegistry)
      private readonly handlerRegistry: HandlerRegistry
  ) {
  }

  async initialize (): Promise<void> {
    this.messagesWithHandlers = {}
    this.handlerRegistry.messageSubscriptions
      .filter(subscription => !!subscription.messageType)
      .map(subscription => subscription.messageType!)
      .map(ctor => new ctor().$name)
      .forEach(messageName => this.messagesWithHandlers[messageName] = {})
  }

  async dispose (): Promise<void> {
    if (this.queue.length > 0) {
      this.logger.warn('Memory queue being shut down, all messages will be lost.', { queueSize: this.queue.length})
    }
  }

  async publish<TEvent extends Event> (event: TEvent, messageOptions?: MessageAttributes): Promise<void> {
    this.addToQueue(event, messageOptions)
  }

  async send<TCommand extends Command> (command: TCommand, messageOptions?: MessageAttributes): Promise<void> {
    this.addToQueue(command, messageOptions)
  }

  async fail (transportMessage: TransportMessage<unknown>): Promise<void> {
    await this.sendToDeadLetterQueue(transportMessage as TransportMessage<InMemoryMessage>)
  }

  async readNextMessage (): Promise<TransportMessage<InMemoryMessage> | undefined> {
    this.logger.debug('Reading next message', { queueSize: this.queue.length })
    return new Promise<TransportMessage<InMemoryMessage> | undefined>(resolve => {
      const onMessageEmitted = () => {
        unsubscribeEmitter()
        clearTimeout(timeoutToken)
        resolve(getNextMessage())
      }
      this.queuePushed.on('pushed', onMessageEmitted)
      const unsubscribeEmitter = () => this.queuePushed.off('pushed', onMessageEmitted)

      // Immediately returns the next available message, or undefined if none are available
      const getNextMessage = () => {
        const availableMessages = this.queue.filter(m => !m.raw.inFlight)
        if (availableMessages.length === 0) {
          this.logger.debug('No messages available in queue')
          return
        }

        const message = availableMessages[0]
        message.raw.inFlight = true
        return message
      }

      const timeoutToken = setTimeout(() => {
        unsubscribeEmitter()
        resolve()
      }, RECEIVE_TIMEOUT_MS)

      const nextMessage = getNextMessage()
      if (nextMessage) {
        unsubscribeEmitter()
        clearTimeout(timeoutToken)
        resolve(nextMessage)
      }
      // Else wait for the timeout (empty return) or emitted event to return
    })
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

  addToQueue (message: MessageType, messageOptions: MessageAttributes = new MessageAttributes()): void {
    const isBusMessage = message instanceof Message
    if (!isBusMessage || this.messagesWithHandlers[(message as Message).$name]) {
      const transportMessage = toTransportMessage(message, messageOptions, false)
      this.queue.push(transportMessage)
      this.queuePushed.emit('pushed')
      this.logger.debug('Added message to queue', { message, queueSize: this.queue.length })
    } else {
      this.logger.warn('Message was not sent as it has no registered handlers', { message })
    }
  }

  get depth (): number {
    return this.queue.length
  }

  get deadLetterQueueDepth (): number {
    return this.deadLetterQueue.length
  }

  private async sendToDeadLetterQueue (message: TransportMessage<InMemoryMessage>): Promise<void> {
    this.deadLetterQueue.push({
      ...message,
      raw: {
        ...message.raw,
        inFlight: false
      }
    })
    await this.deleteMessage(message)
  }
}

export const toTransportMessage = (
  message: MessageType,
  messageAttributes: MessageAttributes,
  isProcessing: boolean
): TransportMessage<InMemoryMessage> => {
  return {
    id: undefined,
    domainMessage: message,
    attributes: messageAttributes,
    raw: {
      seenCount: 0,
      payload: message,
      inFlight: isProcessing
    }
  }
}
