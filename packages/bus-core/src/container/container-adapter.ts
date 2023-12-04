import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'

/**
 * An adapter so that resolvers can use a local DI/IoC container
 * to resolve class based handlers and workflows
 */
export interface ContainerAdapter {
  /**
   * Fetch a class instance from the container
   * @param type Type of the class to fetch an instance for
   * @param context Optional context to pass to the container. This is used in order to allow different resolving containers to be used for different messages.
   * @example get(MessageHandler)
   */
  get<T>(
    type: ClassConstructor<T>,
    context?: { message?: Message; messageAttributes?: MessageAttributes }
  ): T | Promise<T>
}
