import { injectable } from 'inversify'
import { Transport } from './transport'
import { Event, Command, Message } from '@node-ts/bus-messages'

/**
 * An in-memory message queue. This isn't intended for production use as all messages
 * are kept in memory and hence will be wiped when the application or host restarts.
 *
 * There are however legitimate uses for in-memory queues such as decoupling of non-mission
 * critical code inside of larger applications; so use at your own discresion.
 */
@injectable()
export class MemoryQueue implements Transport {

  private queue: Message[] = []

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    this.queue.push(event)
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    this.queue.push(command)
  }

  async readNextMessage (): Promise<Message | undefined> {
    const messages = this.queue.splice(0, 1)
    return messages.length
      ? messages[0]
      : undefined
  }

  async deleteMessage (_: Message): Promise<void> {
    // NOOP
  }

  async returnMessage (message: Message): Promise<void> {
    this.queue.splice(0, 0, message)
  }

  get depth (): number {
    return this.queue.length
  }
}
