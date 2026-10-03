import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { EventEmitter } from 'node:events'
import {
  DefaultInMemoryQueueConfiguration,
  InMemoryMessage,
  InMemoryQueue,
  InMemoryQueueConfiguration,
  TransportHeaderReserved,
  TransportMessage,
  TransportSendOptions
} from '../transport'

/**
 * Called with every message sent or published to a `RecordingInMemoryQueue`
 */
export type MessageDispatched = (
  message: Message,
  attributes: MessageAttributes | undefined,
  sendOptions: TransportSendOptions | undefined
) => void

/**
 * An in-memory queue that reports every message sent or published to it, including those it discards for having
 * no handler, so tests can see what reached the transport. `settled` emits `'deleted'` or `'returned'` with each
 * message the bus deletes or returns. Headers named in `reservedHeaders` are rejected as a real transport would.
 */
export class RecordingInMemoryQueue extends InMemoryQueue {
  readonly settled = new EventEmitter()

  constructor(
    private readonly onDispatched: MessageDispatched,
    configuration: InMemoryQueueConfiguration = new DefaultInMemoryQueueConfiguration(),
    private readonly reservedHeaders: string[] = []
  ) {
    super(configuration)
  }

  assertSendOptions(sendOptions: TransportSendOptions): void {
    const reserved = Object.keys(sendOptions.headers ?? {}).find(name =>
      this.reservedHeaders.includes(name)
    )
    if (reserved) {
      throw new TransportHeaderReserved(reserved, 'RecordingInMemoryQueue')
    }
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.onDispatched(event, messageOptions, sendOptions)
    await super.publish(event, messageOptions, sendOptions)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.onDispatched(command, messageOptions, sendOptions)
    await super.send(command, messageOptions, sendOptions)
  }

  async deleteMessage(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    await super.deleteMessage(message)
    this.settled.emit('deleted', message)
  }

  async returnMessage(
    message: TransportMessage<InMemoryMessage>
  ): Promise<void> {
    await super.returnMessage(message)
    this.settled.emit('returned', message)
  }
}
