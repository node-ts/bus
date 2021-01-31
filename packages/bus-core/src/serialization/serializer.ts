import { Message } from '@node-ts/bus-messages'
import { handlerRegistry } from '../handler'
import { ClassConstructor } from '../util'
import { JsonSerializer } from './json-serializer'

let configuredSerializer: Serializer | undefined
const defaultSerializer = new JsonSerializer()

export const getSerializer = () => configuredSerializer || defaultSerializer
export const setSerializer = (serializer: Serializer) => {
  configuredSerializer = serializer
}

/**
 * A serializer that's use to serialize/deserialize objects as they leave and enter the application boundary.
 */
export interface Serializer {
  serialize<T extends object> (obj: T): string
  deserialize<T extends object> (val: string, classType: ClassConstructor<T>): T
  toPlain<T extends object> (obj: T): object
  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T
}

/**
 * This a wrapper around the real serializer.
 * Unlike JsonSerializer, whose sole job is parsing data,
 * this class will do some plumbing work to look up the Handler Registry for
 * the message constructor.
 *
 * Normally, transports will use this instead of the real serializer.
 */
export const MessageSerializer = {
  serialize<MessageType extends Message> (message: MessageType): string {
    return getSerializer().serialize(message)
  },

  deserialize<MessageType extends Message> (serializedMessage: string): MessageType {
    const naiveDeserializedMessage = JSON.parse(serializedMessage) as Message
    const messageType = handlerRegistry.getMessageConstructor(naiveDeserializedMessage.$name)

    return (!!messageType
      ? getSerializer().deserialize(
          serializedMessage,
          messageType
        )
      : naiveDeserializedMessage) as MessageType
  }
}
