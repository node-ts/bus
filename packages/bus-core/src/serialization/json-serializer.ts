import { Serializer } from './serializer'
import { ClassConstructor } from '../util'

/**
 * A naive and generally unsafe default JSON serializer. This relies on
 * the native JSON.stringify/parse functions that do a basic job of serialization.
 * Deserialized forms will be plain objects with class properties (eg Date) not
 * being a strong type.
 *
 * It's recommended that an external serializer like `@node-ts/bus-class-serializer`
 * be used instead that will preserve types when serialized/deserialized.
 */
export class JsonSerializer implements Serializer {
  serialize<ObjectType extends object>(obj: ObjectType): string {
    return JSON.stringify(obj)
  }

  deserialize<ObjectType extends object>(
    serialized: string,
    classConstructor: ClassConstructor<ObjectType>
  ): ObjectType {
    const plain = JSON.parse(serialized)
    return this.toClass(plain, classConstructor)
  }

  toPlain<T extends object>(obj: T): object {
    return JSON.parse(JSON.stringify(obj))
  }

  toClass<T extends object>(
    obj: object,
    classConstructor: ClassConstructor<T>
  ): T {
    const instance = new classConstructor()
    Object.assign(instance, obj)
    return instance
  }
}
