import {
  InMemoryMessage,
  TransportInitializationOptions,
  TransportMessage
} from '@node-ts/bus-core'
import { Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { TestSystemMessage } from '../helpers/test-system-message'
import { SerializingInMemoryQueue } from './serializing-in-memory-queue'

/**
 * A serializing in-memory queue with the callbacks `transportTests` needs. It also queues
 * `TestSystemMessage`, which only has a custom handler, like a broker delivering a message from a topic the bus
 * subscribes to. `InMemoryQueue` discards any other message without a registered handler.
 */
export class TransportTestInMemoryQueue extends SerializingInMemoryQueue {
  private readonly deadLetterEvents = new EventEmitter()
  private deadLettersRead = 0

  async initialize(options?: TransportInitializationOptions): Promise<void> {
    const handlerRegistry = options!.handlerRegistry
    await super.initialize({
      ...options!,
      handlerRegistry: Object.create(handlerRegistry, {
        getMessageNames: {
          value: () => [
            ...handlerRegistry.getMessageNames(),
            TestSystemMessage.NAME
          ]
        }
      }) as typeof handlerRegistry
    })
  }

  async fail(
    transportMessage: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    await super.fail(transportMessage)
    this.deadLetterEvents.emit('changed')
  }

  async returnMessage(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    await super.returnMessage(message)
    this.deadLetterEvents.emit('changed')
  }

  /**
   * Publishes a `TestSystemMessage` straight to the queue, without the bus, so it has no `messageId` or `sentAt`
   * @param systemMessage the value of the message's `systemMessage` attribute
   */
  publishSystemMessage = async (systemMessage: string): Promise<void> =>
    this.publish(new TestSystemMessage() as unknown as Event, {
      attributes: { systemMessage },
      stickyAttributes: {}
    })

  /**
   * Waits for a message to be dead-lettered, then returns every message dead-lettered since the last call
   */
  readAllFromDeadLetterQueue = async (): Promise<
    { message: Message; attributes: MessageAttributes }[]
  > => {
    while (this.deadLetterQueueDepth <= this.deadLettersRead) {
      await once(this.deadLetterEvents, 'changed')
    }
    const deadLetters = this.deadLetterQueue.slice(this.deadLettersRead)
    this.deadLettersRead = this.deadLetterQueueDepth
    return deadLetters.map(deadLetter => ({
      message: deadLetter.domainMessage as Message,
      attributes: deadLetter.attributes
    }))
  }
}
