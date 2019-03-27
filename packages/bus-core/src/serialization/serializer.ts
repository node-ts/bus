import { ClassConstructor } from '../util'

export interface Serializer {
  serialize<T extends object> (obj: T): string
  deserialize<T extends object> (val: string, classType: ClassConstructor<T>): T
}
