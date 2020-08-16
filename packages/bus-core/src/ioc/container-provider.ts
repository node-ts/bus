import { ClassConstructor } from '../util'

export interface ContainerProvider {
  get<T> (instance: ClassConstructor<T>): T
}
