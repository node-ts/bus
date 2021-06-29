import { ClassConstructor } from '../util'

let configuredContainer: ContainerAdapter | undefined
export const getContainer = () => configuredContainer
export const setContainer = (container: ContainerAdapter) => configuredContainer = container

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
