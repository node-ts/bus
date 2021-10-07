import { Message } from '@node-ts/bus-messages'
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

  constructor (
    private readonly serializer: Serializer,
    private readonly handlerRegistry: HandlerRegistry
  ) {
  }

  serialize<MessageType extends Message> (message: MessageType): string {
    return this.serializer.serialize(message)
  }

  deserialize<MessageType extends Message> (serializedMessage: string): MessageType {
    const naiveDeserializedMessage = JSON.parse(serializedMessage) as Message
    const messageType = this.handlerRegistry.getMessageConstructor(naiveDeserializedMessage.$name)

    return (!!messageType
      ? this.serializer.deserialize(
          serializedMessage,
          messageType
        )
      : naiveDeserializedMessage) as MessageType
  }
}
