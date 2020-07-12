import { ClassConstructor } from '../util'
import { Message } from '@node-ts/bus-messages'

/**
 * A serializer that's use to serialize messages before they go onto the transport, and deserialize them as they
 * are read from the transport.
 */
export interface Serializer {
  /**
   * Serializes a message into a string representation so it can be written to an underlying queue/topic
   * @param message Message to serialize
   */
  serialize<MessageType extends Message> (message: MessageType): string

  /**
   * Deserializes a string-based representation of message back into a strong class type.
   * @param serialized Serialized string of the message to deserialize
   * @param classType Type of the class to deserialize the message back into
   */
  deserialize<MessageType extends Message> (serialized: string, classType: ClassConstructor<MessageType>): MessageType
}
