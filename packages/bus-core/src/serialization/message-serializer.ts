import { Message, MessageTypes } from '@node-ts/bus-messages'
import { HandlerRegistry } from '../handler'
import { ClassConstructor } from '../util'
import { JsonSerializer } from './json-serializer'
import { Serializer } from './serializer'

/**
 * This a wrapper around the real serializer.
 * Unlike JsonSerializer, whose sole job is parsing data,
 * this class will do some plumbing work to look up the Handler Registry for
 * the message constructor.
 *
 * Normally, transports will use this instead of the real serializer. Each bus has its own, which
 * restores messages with that bus' handlers and message types.
 */
export class MessageSerializer {
  /**
   * @param serializer the serializer the bus is configured with
   * @param handlerRegistry the handlers of the bus, which give the class of each message
   * @param messageTypes the message types the bus is configured with
   */
  constructor(
    private readonly serializer: Serializer,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly messageTypes: MessageTypes
  ) {}

  serialize<MessageType extends Message>(message: MessageType): string {
    return this.serializer.serialize(message)
  }

  /**
   * Parses a message. A message that has a handler registered is created from its message class, or as a
   * plain object for a message declared with `defineCommand` or `defineEvent`. With the default `JsonSerializer`, a
   * message without one, such as one handled by a custom handler, is still restored as a plain object when the
   * bus' message types have it, e.g. for a message declared as an interface. A custom serializer only gets the
   * messages that have a handler, since it may not use message types.
   * @param serializedMessage the message as it was received
   * @returns the message
   */
  deserialize<MessageType extends Message>(
    serializedMessage: string
  ): MessageType {
    const naiveDeserializedMessage = JSON.parse(serializedMessage) as Message
    const messageName = naiveDeserializedMessage.$name
    const messageType =
      this.handlerRegistry.getMessageConstructor(messageName) ??
      this.registeredPlainType(messageName)

    return (
      !!messageType
        ? this.serializer.deserialize(
            serializedMessage,
            messageType,
            this.messageTypes
          )
        : naiveDeserializedMessage
    ) as MessageType
  }

  /**
   * `Object`, so the message is restored as a plain object, when the default serializer is used and its
   * `$name` is in the bus' message types but has no handler
   */
  private registeredPlainType(
    messageName: unknown
  ): ClassConstructor<object> | undefined {
    return this.serializer instanceof JsonSerializer &&
      typeof messageName === 'string' &&
      Object.hasOwn(this.messageTypes.messages, messageName)
      ? Object
      : undefined
  }
}
