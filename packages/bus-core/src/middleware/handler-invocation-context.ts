import { IncomingContext } from './incoming-context'

/**
 * The context a `handler` middleware gets each time a handler or workflow handler is called for a message. The
 * middleware runs inside that handler's outbox, so its sends and publishes are buffered with the handler's and
 * dropped if the handler fails.
 * @example
 * const logHandlers: Middleware<HandlerInvocationContext> = async (context, next) => {
 *   console.log(`${context.handlerName} is handling ${context.message.$name}`)
 *   await next()
 * }
 */
export interface HandlerInvocationContext extends IncomingContext {
  /**
   * The name of the handler: the class name of a class handler, the name of a workflow, or the name of a function
   * handler. A function handler without a name, such as an inline arrow function, is `'anonymous'`.
   */
  readonly handlerName: string
}
