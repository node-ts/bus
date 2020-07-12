import { ClassConstructor } from '../util'

/**
 * A serializer that's use to serialize/deserialize objects as they leave and enter the application boundary.
 */
export interface Serializer {
  /**
   * Serializes a message into a string representation so it can be written to an underlying queue/topic
   * @param obj Message to serialize
   */
  serialize<ObjectType extends object> (obj: ObjectType): string

  /**
   * Deserializes a string-based representation of an object back into a strong class type.
   * @param serialized Serialized string of the object to deserialize
   * @param classType Type of the class to deserialize the object back into
   */
  deserialize<ObjectType extends object> (serialized: string, classType: ClassConstructor<ObjectType>): ObjectType
}
