import { Serializer } from './serializer'
import { ClassConstructor } from '../util'
import { classToPlain, plainToClass, serialize, deserialize } from 'class-transformer'

/**
 * A very unsafe, basic JSON serializer. This will serialize objects to strings, but will
 * deserialize strings into plain objects. These will NOT contain methods or special types,
 * so the usage of this serializer is limited.
 */
export class JsonSerializer implements Serializer {
  serialize<T extends object> (obj: T): string {
    return serialize(obj)
  }

  deserialize<T extends object> (val: string, classConstructor: ClassConstructor<T>): T {
    return deserialize<T> (classConstructor, val)
  }

  toPlain<T extends object> (obj: T): object {
    return classToPlain(obj)
  }

  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T {
    return plainToClass(classConstructor, obj)
  }
}
