import { MessageTypes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'

/**
 * A serializer that's use to serialize/deserialize objects as they leave and enter the application boundary.
 *
 * A serializer holds no state of its own bus, so one instance can be shared by several buses. Each bus passes
 * the message types it was configured with, using `withMessageTypes()`, to every call that restores an object.
 */
export interface Serializer {
  /**
   * Writes an object as a string
   * @param obj the message or workflow state to write
   * @returns the serialized object
   */
  serialize<T extends object>(obj: T): string

  /**
   * Reads an object written by `serialize`
   * @param val the serialized object
   * @param classType the class the top-level object is created from
   * @param messageTypes the message types of the bus that's reading the object, which say how to restore its
   * nested values
   * @returns the object
   */
  deserialize<T extends object>(
    val: string,
    classType: ClassConstructor<T>,
    messageTypes?: MessageTypes
  ): T

  /**
   * Converts an object to a plain object that JSON can represent
   * @param obj the message or workflow state to convert
   * @returns the plain object
   */
  toPlain<T extends object>(obj: T): object

  /**
   * Converts a plain object, such as one returned by `toPlain`, back to its class
   * @param obj the plain object
   * @param classConstructor the class the top-level object is created from
   * @param messageTypes the message types of the bus that's reading the object, which say how to restore its
   * nested values
   * @returns the object
   */
  toClass<T extends object>(
    obj: object,
    classConstructor: ClassConstructor<T>,
    messageTypes?: MessageTypes
  ): T
}
