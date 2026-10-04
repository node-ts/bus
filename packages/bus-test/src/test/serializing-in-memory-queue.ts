import {
  CoreDependencies,
  InMemoryQueue,
  MessageSerializer
} from '@node-ts/bus-core'
import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'

/**
 * An in-memory queue that puts each message through the bus' `MessageSerializer` when it's sent,
 * like a broker would. `InMemoryQueue` hands the sent object itself to the handler, so without
 * this the round trip suites wouldn't exercise the serializer at all.
 */
export class SerializingInMemoryQueue extends InMemoryQueue {
  private messageSerializer: MessageSerializer

  prepare(coreDependencies: CoreDependencies): void {
    super.prepare(coreDependencies)
    this.messageSerializer = coreDependencies.messageSerializer
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes
  ): Promise<void> {
    await super.publish(this.roundTrip(event), copy(messageOptions))
  }

  async send<TCommand extends Command>(
    command: TCommand,
    messageOptions?: MessageAttributes
  ): Promise<void> {
    await super.send(this.roundTrip(command), copy(messageOptions))
  }

  async sendToAddress(
    address: string,
    message: Message,
    messageOptions?: MessageAttributes
  ): Promise<void> {
    await super.sendToAddress(
      address,
      this.roundTrip(message),
      copy(messageOptions)
    )
  }

  private roundTrip<TMessage extends Message>(message: TMessage): TMessage {
    return this.messageSerializer.deserialize<TMessage>(
      this.messageSerializer.serialize(message)
    )
  }
}

const copy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
