import { Serializer, ClassConstructor } from '@node-ts/bus-core'
import { instanceToPlain, plainToInstance, serialize, deserialize } from 'class-transformer'

/**
 * A JSON-based serializer that uses `class-transformer` to transform to and from
 * class instances of an object rather than just their plain types. As a result,
 * object types can use all of the serialization decorator hints provided by
 * that library.
 */
export class ClassSerializer implements Serializer {
  serialize<ObjectType extends object> (obj: ObjectType): string {
    return serialize(obj)
  }

  deserialize<ObjectType extends object> (
    serialized: string,
    classConstructor: ClassConstructor<ObjectType>
  ): ObjectType {
    return deserialize<ObjectType> (classConstructor, serialized)
  }

  toPlain<T extends object> (obj: T): object {
    return instanceToPlain(obj)
  }

  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T {
    return plainToInstance(classConstructor, obj)
  }
}
