import { getMessageTypes, Message } from '@node-ts/bus-messages'
import { HandlerRegistry } from '../handler'
import { Serializer } from './serializer'

/**
 * This a wrapper around the real serializer.
 * Unlike JsonSerializer, whose sole job is parsing data,
 * this class will do some plumbing work to look up the Handler Registry for
 * the message constructor.
 *
 * Normally, transports will use this instead of the real serializer.
 */
export class MessageSerializer {
  constructor(
    private readonly serializer: Serializer,
    private readonly handlerRegistry: HandlerRegistry
  ) {}

  serialize<MessageType extends Message>(message: MessageType): string {
    return this.serializer.serialize(message)
  }

  /**
   * Parses a message. A message that has a handler registered is created from its message class, or as a
   * plain object for a message declared with `defineCommand` or `defineEvent`. A message without one, such
   * as one handled by a custom handler, is still restored as a plain object when its message types are
   * registered, e.g. for a message declared as an interface.
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
      (typeof messageName === 'string' &&
      Object.hasOwn(getMessageTypes().messages, messageName)
        ? Object
        : undefined)

    return (
      !!messageType
        ? this.serializer.deserialize(serializedMessage, messageType)
        : naiveDeserializedMessage
    ) as MessageType
  }
}
