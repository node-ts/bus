import { injectable } from 'inversify'
import { Transport } from './transport'
import { Event, Command, Message } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'

interface InMemoryMessage {
  isProcessing: boolean
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

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    const message = toTransportMessage(event, false)
    this.queue.push(message)
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    const message = toTransportMessage(command, false)
    this.queue.push(message)
  }

  async readNextMessage (): Promise<TransportMessage<InMemoryMessage> | undefined> {
    const messages = this.queue.filter(message => !message.raw.isProcessing).splice(0, 1)
    const message = messages.length
      ? messages[0]
      : undefined

    if (message) {
      message.raw.isProcessing = true
    }
    return message
  }

  async deleteMessage (message: TransportMessage<InMemoryMessage>): Promise<void> {
    const index = this.queue.indexOf(message)
    this.queue.splice(index, 1)
  }

  async returnMessage (message: TransportMessage<InMemoryMessage>): Promise<void> {
    message.raw.isProcessing = false
  }

  get depth (): number {
    return this.queue.length
  }
}

function toTransportMessage (message: Message, isProcessing: boolean): TransportMessage<InMemoryMessage> {
  return {
    id: undefined,
    domainMessage: message,
    raw: {
      payload: message,
      isProcessing
    }
  }
}

function fromTransportMessage (message: TransportMessage<InMemoryMessage>): Message {
  return message.domainMessage
}
