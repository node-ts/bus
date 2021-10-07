import { ClassConstructor } from '../util'

/**
 * A serializer that's use to serialize/deserialize objects as they leave and enter the application boundary.
 */
export interface Serializer {
  serialize<T extends object> (obj: T): string
  deserialize<T extends object> (val: string, classType: ClassConstructor<T>): T
  toPlain<T extends object> (obj: T): object
  toClass<T extends object> (obj: object, classConstructor: ClassConstructor<T>): T
}
