import { ClassConstructor } from '../util'

/**
 * An adapter so that resolvers can use a local DI/IoC container
 * to resolve class based handlers and workflows
 */
export interface ContainerAdapter {
  /**
   * Fetch a class instance from the container
   * @param type Type of the class to fetch an instance for
   * @example get(MessageHandler)
   */
  get <T>(type: ClassConstructor<T>): T
}
