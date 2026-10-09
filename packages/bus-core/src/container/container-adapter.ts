import { ClassConstructor } from '../util'
import { ContainerContext } from './container-context'

/**
 * An adapter so that resolvers can use a local DI/IoC container
 * to resolve class based handlers and workflows
 */
export interface ContainerAdapter {
  /**
   * Fetch a class instance from the container
   * @param type Type of the class to fetch an instance for
   * @param context The message being handled, its attributes and its delivery (`transportMessage`), so a container
   * can resolve differently for each message. Every class handler and workflow that handles one delivery is given
   * the same `transportMessage`, and a retry of the message a new one.
   * @returns the instance, or a promise of it
   * @example get(MessageHandler)
   */
  get<T>(type: ClassConstructor<T>, context?: ContainerContext): T | Promise<T>
}
