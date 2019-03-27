import { injectable } from 'inversify'
import { Serializer } from './serializer'
import { ClassConstructor } from '../util'

/**
 * A very unsafe, basic JSON serializer. This will serialize objects to strings, but will
 * deserialize strings into plain objects. These will NOT contain methods or special types,
 * so the usage of this serializer is limited.
 */
@injectable()
export class JsonSerializer implements Serializer {
  serialize<T extends object> (obj: T): string {
    return JSON.stringify(obj)
  }

  deserialize<T extends object> (val: string, _: ClassConstructor<T>): T {
    return JSON.parse(val) as T
  }
}
