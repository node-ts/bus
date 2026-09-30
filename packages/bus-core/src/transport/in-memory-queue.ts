import { Transport, TransportInitializationOptions } from './transport'
import {
  Event,
  Command,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { EventEmitter } from 'events'
import { CoreDependencies } from '../util'
import { Logger } from '../logger'
import { Milliseconds } from '../retry-strategy'
import { InMemoryQueueConfiguration } from './in-memory-queue-configuration'
import { DefaultInMemoryQueueConfiguration } from './default-in-memory-queue-configuration'

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
 * critical code inside of larger applications; so use at your own discretion.
 */
export class InMemoryQueue implements Transport<InMemoryMessage> {
  private queue: TransportMessage<InMemoryMessage>[] = []
  private queueEvents = new EventEmitter().setMaxListeners(0)
  private _deadLetterQueue: TransportMessage<InMemoryMessage>[] = []
  /**
   * Names of messages that have a local handler. Until the queue is initialized by a bus that
   * handles messages, this is undefined and all messages are queued.
   */
  private messagesWithHandlers: Set<string> | undefined
  private retryTimeouts = new Set<NodeJS.Timeout>()
  private logger!: Logger
  private coreDependencies!: CoreDependencies

  constructor(
    private memoryQueueConfiguration: InMemoryQueueConfiguration = new DefaultInMemoryQueueConfiguration()
  ) {}

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:in-memory-queue'
    )
  }

  /**
   * Records which messages have local handlers so that messages nothing will handle aren't queued.
   * When initialized in send-only mode, or by a bus with no handlers, all messages are kept on the
   * queue so that a producer's messages can be read or inspected.
   * @param options the handler registry of the bus, and whether it's send-only
   */
  async initialize(options?: TransportInitializationOptions): Promise<void> {
    if (options?.sendOnly) {
      return
    }
    const handlerRegistry =
      options?.handlerRegistry ?? this.coreDependencies.handlerRegistry
    const messageNames = handlerRegistry.getMessageNames()
    this.messagesWithHandlers = messageNames.length
      ? new Set(messageNames)
      : undefined
  }

  /**
   * Cancels pending retries and reads so that the queue doesn't keep the process alive
   */
  async dispose(): Promise<void> {
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout))
    this.retryTimeouts.clear()
    this.queueEvents.emit('disposed')

    if (this.queue.length > 0) {
      this.logger.warn(
        'In-Memory queue being shut down, all messages will be lost.',
        { queueSize: this.queue.length }
      )
    }
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes
  ): Promise<void> {
    this.addToQueue(event, messageOptions)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    messageOptions?: MessageAttributes
  ): Promise<void> {
    this.addToQueue(command, messageOptions)
  }

  async fail(
    transportMessage: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    await this.sendToDeadLetterQueue(transportMessage)
  }

  /**
   * Returns the next visible message. If none are visible, waits until one becomes visible or
   * `receiveTimeoutMs` elapses, in which case undefined is returned.
   */
  async readNextMessage(): Promise<
    TransportMessage<InMemoryMessage> | undefined
  > {
    this.logger.debug('Reading next message', {
      depth: this.depth,
      numberMessagesVisible: this.numberMessagesVisible
    })

    const nextMessage = this.takeNextMessage()
    if (nextMessage) {
      return nextMessage
    }

    return new Promise<TransportMessage<InMemoryMessage> | undefined>(
      resolve => {
        const complete = (message?: TransportMessage<InMemoryMessage>) => {
          clearTimeout(timeoutToken)
          this.queueEvents.off('visible', onMessageVisible)
          this.queueEvents.off('disposed', onDisposed)
          resolve(message)
        }
        const onMessageVisible = () => {
          // Another reader may have already taken the message, in which case keep waiting
          const message = this.takeNextMessage()
          if (message) {
            complete(message)
          }
        }
        const onDisposed = () => complete(undefined)
        const timeoutToken = setTimeout(() => {
          this.logger.debug('No messages available in queue')
          complete(undefined)
        }, this.memoryQueueConfiguration.receiveTimeoutMs)

        this.queueEvents.on('visible', onMessageVisible)
        this.queueEvents.on('disposed', onDisposed)
      }
    )
  }

  async deleteMessage(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    const messageIndex = this.queue.indexOf(message)
    if (messageIndex < 0) {
      // actions like .failMessage() will cause the message to already be deleted
      this.logger.debug('Message already deleted', { message, messageIndex })
      return
    }
    this.logger.debug('Deleting message', {
      queueDepth: this.depth,
      messageIndex
    })
    this.queue.splice(messageIndex, 1)
    this.logger.debug('Message Deleted', { queueDepth: this.depth })
  }

  async returnMessage(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    const delay: Milliseconds =
      this.coreDependencies.retryStrategy.calculateRetryDelay(
        message.raw.seenCount
      )
    message.raw.seenCount++

    if (message.raw.seenCount >= this.memoryQueueConfiguration.maxRetries) {
      // Message retries exhausted, send to DLQ
      this.logger.info(
        'Message retry limit exceeded, sending to dead letter queue',
        { message }
      )
      await this.sendToDeadLetterQueue(message)
    } else {
      const retryTimeout = setTimeout(() => {
        this.retryTimeouts.delete(retryTimeout)
        message.raw.inFlight = false
        this.queueEvents.emit('visible')
      }, delay)
      this.retryTimeouts.add(retryTimeout)
    }
  }

  /**
   * Gets the queue depth, which is the number of messages both queued and in flight
   */
  get depth(): number {
    return this.queue.length
  }

  get deadLetterQueueDepth(): number {
    return this._deadLetterQueue.length
  }

  /**
   * Returns all messages sitting in the dead letter queue. This is a copy of the queue
   * so mutative actions on this array will have no consequence.
   */
  get deadLetterQueue(): TransportMessage<InMemoryMessage>[] {
    return [...this._deadLetterQueue]
  }

  /**
   * Gets the number of messages in the queue, excluding those in flight
   */
  get numberMessagesVisible(): number {
    return this.queue.filter(m => !m.raw.inFlight).length
  }

  /**
   * Marks the oldest visible message as in flight and returns it, or undefined if none are visible
   */
  private takeNextMessage(): TransportMessage<InMemoryMessage> | undefined {
    const message = this.queue.find(m => !m.raw.inFlight)
    if (message) {
      message.raw.inFlight = true
    }
    return message
  }

  private async sendToDeadLetterQueue(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    this._deadLetterQueue.push(message)
    await this.deleteMessage(message)
  }

  private addToQueue(
    message: Message,
    messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): void {
    if (
      this.messagesWithHandlers &&
      !this.messagesWithHandlers.has(message.$name)
    ) {
      this.logger.warn(
        'Message was not sent as it has no registered handlers',
        { message }
      )
      return
    }

    const transportMessage = toTransportMessage(message, messageOptions, false)
    this.queue.push(transportMessage)
    this.logger.debug('Added message to queue', {
      message,
      queueSize: this.queue.length
    })
    this.queueEvents.emit('visible')
  }
}

export const toTransportMessage = (
  message: Message,
  messageOptions: MessageAttributes,
  isProcessing: boolean
): TransportMessage<InMemoryMessage> => ({
  id: undefined,
  domainMessage: message,
  attributes: messageOptions,
  raw: {
    seenCount: 0,
    payload: message,
    inFlight: isProcessing
  }
})
