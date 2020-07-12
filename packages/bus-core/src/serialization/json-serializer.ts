import { injectable } from 'inversify'
import { Serializer } from './serializer'
import { ClassConstructor } from '../util'
import { classToPlain, plainToClass, serialize, deserialize } from 'class-transformer'

/**
 * A JSON-based serializer that uses `class-transformer` to transform to and from
 * class instances of an object rather than just their plain types. As a result,
 * object types can use all of the serialization decorator hints provided by
 * that library.
 */
@injectable()
export class JsonSerializer implements Serializer {
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
    return classToPlain(obj)
  }

  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T {
    return plainToClass(classConstructor, obj)
  }
}
