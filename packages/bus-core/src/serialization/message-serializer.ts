import { injectable, inject } from 'inversify'
import { Serializer } from './serializer'
import { BUS_SYMBOLS } from '../bus-symbols'
import { HandlerRegistry } from '../handler'
import { Message } from '@node-ts/bus-messages'

/**
 * This a wrapper around the real serializer.
 * Unlike JsonSerializer, whose sole job is parsing data,
 * this class will do some plumbing work to look up the Handler Registry for
 * the message constructor.
 *
 * Normally, transports will use this instead of the real serializer.
 */
@injectable()
export class MessageSerializer {

  constructor (
    @inject(BUS_SYMBOLS.Serializer)
      readonly serializer: Serializer,
    @inject(BUS_SYMBOLS.HandlerRegistry)
      readonly handlerRegistry: HandlerRegistry
  ) {
  }

  serialize<MessageType extends Message> (message: MessageType): string {
    return this.serializer.serialize(message)
  }

  deserialize<MessageType extends Message> (serializedMessage: string): MessageType {
      const naiveDerializedMessage = JSON.parse(serializedMessage) as Message
      const messageType = this.handlerRegistry.getMessageType(naiveDerializedMessage)

      return (!!messageType
        ? this.serializer.deserialize(
          serializedMessage,
          messageType
        ) : naiveDerializedMessage) as MessageType
  }
}
