import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { EventEmitter } from 'events'
import { Logger } from '../logger'
import {
  FAILURE_HEADER,
  MessageFailure,
  toFailureHeader
} from '../recoverability'
import { CoreDependencies, Milliseconds } from '../util'
import {
  DEFAULT_IN_MEMORY_ENDPOINT_NAME,
  DefaultInMemoryQueueConfiguration
} from './default-in-memory-queue-configuration'
import {
  EndpointNotFound,
  InMemoryQueueDisposed,
  TransportHeaderReserved
} from './error'
import { InMemoryQueueConfiguration } from './in-memory-queue-configuration'
import { Transport, TransportInitializationOptions } from './transport'
import { TransportMessage } from './transport-message'
import {
  TransportHeaders,
  TransportSendOptions
} from './transport-send-options'

export interface InMemoryMessage {
  /**
   * If the message is currently being handled and not visible to other consumers
   */
  inFlight: boolean

  /**
   * How many times handling the message has failed, which is how many times it has been returned to the queue
   */
  failedAttempts: number

  /**
   * The body of the message that was sent by the consumer
   */
  payload: Message

  /**
   * The native headers the message was sent with, as set by outgoing middleware. A dead-lettered copy also has the
   * `bus-failure` header.
   */
  headers: TransportHeaders
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
   * Names of messages that have a local handler. Any other message is discarded, including
   * everything sent before the queue is initialized.
   */
  private messagesWithHandlers = new Set<string>()
  private retryTimeouts = new Set<NodeJS.Timeout>()
  private isDisposed = false
  private logger!: Logger
  private coreDependencies!: CoreDependencies

  /**
   * The `endpointName` from the configuration
   * @default in-memory
   */
  readonly endpointName: string

  constructor(
    private memoryQueueConfiguration: InMemoryQueueConfiguration = new DefaultInMemoryQueueConfiguration()
  ) {
    this.endpointName =
      memoryQueueConfiguration.endpointName ?? DEFAULT_IN_MEMORY_ENDPOINT_NAME
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:in-memory-queue'
    )
  }

  /**
   * Records which messages have local handlers. Messages without one are discarded when sent.
   * @param options the handler registry of the bus
   */
  async initialize(options?: TransportInitializationOptions): Promise<void> {
    const handlerRegistry =
      options?.handlerRegistry ?? this.coreDependencies.handlerRegistry
    this.messagesWithHandlers = new Set(handlerRegistry.getMessageNames())
  }

  /**
   * Cancels pending retries and reads so that the queue doesn't keep the process alive
   */
  async dispose(): Promise<void> {
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout))
    this.retryTimeouts.clear()
    this.isDisposed = true
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
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.addToQueue(event, messageOptions, sendOptions)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.addToQueue(command, messageOptions, sendOptions)
  }

  /**
   * Adds a message to this queue, which is the only return address an in-memory queue can reach: its
   * `endpointName`. Unlike `send` and `publish`, it's queued even if it has no handler, like a message sent to a
   * broker's queue, and the bus discards it when it's read.
   * @param address the return address to send to, which must be this queue's `endpointName`
   * @param message the message to send
   * @param messageOptions the attributes to send it with
   * @param sendOptions native headers from outgoing middleware
   * @throws EndpointNotFound if `address` isn't this queue's `endpointName`
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    if (address !== this.endpointName) {
      throw new EndpointNotFound(address, 'InMemoryQueue')
    }
    this.enqueue(message, messageOptions, sendOptions)
  }

  /**
   * Rejects a `bus-failure` header, which the queue writes on dead-lettered messages itself
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  assertSendOptions(sendOptions: TransportSendOptions): void {
    if (sendOptions.headers && FAILURE_HEADER in sendOptions.headers) {
      throw new TransportHeaderReserved(FAILURE_HEADER, 'InMemoryQueue')
    }
  }

  /**
   * Moves a message to the dead letter queue, with its failure metadata in a `bus-failure` header
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<InMemoryMessage>,
    failure: MessageFailure
  ): Promise<void> {
    this._deadLetterQueue.push({
      ...transportMessage,
      raw: {
        ...transportMessage.raw,
        headers: {
          ...transportMessage.raw.headers,
          [FAILURE_HEADER]: toFailureHeader(failure)
        }
      }
    })
    this.removeFromQueue(transportMessage)
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
    this.removeFromQueue(message)
  }

  /**
   * Makes a message visible again after `delay`, counting one more failed attempt
   * @param message the message to return
   * @param delay how long until it can be read again, in milliseconds
   */
  async returnMessage(
    message: TransportMessage<InMemoryMessage>,
    delay: Milliseconds
  ): Promise<void> {
    message.raw.failedAttempts++
    const retryTimeout = setTimeout(() => {
      this.retryTimeouts.delete(retryTimeout)
      message.raw.inFlight = false
      this.queueEvents.emit('visible')
    }, delay)
    this.retryTimeouts.add(retryTimeout)
  }

  /**
   * Waits until the queue has nothing left to handle: no message queued, being handled or waiting to be retried. A
   * message is only removed once the bus has finished handling it, after the messages its handlers sent were queued,
   * so a test can send a message to a started bus and await this instead of listening for the handler to finish.
   *
   * Messages sent with `deliverAfter` or `deliverAt` wait in the bus' persistence, not in the queue, so they aren't
   * waited for until they're sent. Nothing is handled before the bus is started, so a queue with messages in it
   * isn't idle until then.
   *
   * A queue that's disposed with messages still in it will never be idle, so the promise rejects, rather than never
   * settling and holding the test until it times out.
   * @returns a promise that resolves once the queue is empty, or straight away if it already is
   * @throws InMemoryQueueDisposed if the queue is disposed, or already was, while messages are left in it
   * @example
   * const queue = new InMemoryQueue()
   * const bus = Bus.configure().withTransport(queue).withHandler(placeOrderHandler).build()
   * await bus.initialize()
   * await bus.start()
   *
   * await bus.send(new PlaceOrder('1'))
   * await queue.idle()
   */
  async idle(): Promise<void> {
    if (this.queue.length === 0) {
      return
    }
    if (this.isDisposed) {
      throw new InMemoryQueueDisposed(this.endpointName, this.queue.length)
    }
    await new Promise<void>((resolve, reject) => {
      const onIdle = () => {
        this.queueEvents.off('disposed', onDisposed)
        resolve()
      }
      const onDisposed = () => {
        this.queueEvents.off('idle', onIdle)
        reject(new InMemoryQueueDisposed(this.endpointName, this.queue.length))
      }
      this.queueEvents.once('idle', onIdle)
      this.queueEvents.once('disposed', onDisposed)
    })
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
   * Removes a message from the queue, whether it was handled or dead-lettered
   */
  private removeFromQueue(message: TransportMessage<InMemoryMessage>): void {
    // Each read hands out a copy with the current failedAttempts, so find the message by its raw message
    const messageIndex = this.queue.findIndex(m => m.raw === message.raw)
    if (messageIndex < 0) {
      this.logger.debug('Message already deleted', { message, messageIndex })
      return
    }
    this.logger.debug('Deleting message', {
      queueDepth: this.depth,
      messageIndex
    })
    this.queue.splice(messageIndex, 1)
    this.logger.debug('Message Deleted', { queueDepth: this.depth })
    if (this.queue.length === 0) {
      this.queueEvents.emit('idle')
    }
  }

  /**
   * Marks the oldest visible message as in flight and returns it, or undefined if none are visible
   */
  private takeNextMessage(): TransportMessage<InMemoryMessage> | undefined {
    const message = this.queue.find(m => !m.raw.inFlight)
    if (!message) {
      return undefined
    }
    message.raw.inFlight = true
    // A copy, because the bus freezes the message it handles and the count changes each time it's returned
    return { ...message, failedAttempts: message.raw.failedAttempts }
  }

  /**
   * Adds a sent or published message to the queue if it has a handler, as if the queue only subscribes to the
   * messages it handles
   */
  private addToQueue(
    message: Message,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): void {
    if (!this.messagesWithHandlers.has(message.$name)) {
      this.logger.debug(
        'Message was not sent as it has no registered handlers',
        { message }
      )
      return
    }
    this.enqueue(message, messageOptions, sendOptions)
  }

  private enqueue(
    message: Message,
    messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    },
    sendOptions: TransportSendOptions = {}
  ): void {
    const transportMessage = toTransportMessage(
      message,
      messageOptions,
      false,
      sendOptions.headers
    )
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
  isProcessing: boolean,
  headers: TransportHeaders = {}
): TransportMessage<InMemoryMessage> => ({
  id: undefined,
  domainMessage: message,
  attributes: messageOptions,
  failedAttempts: 0,
  raw: {
    failedAttempts: 0,
    payload: message,
    inFlight: isProcessing,
    headers: { ...headers }
  }
})
