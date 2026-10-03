import { HandlerInvocationContext } from './handler-invocation-context'
import { IncomingContext } from './incoming-context'
import { Middleware } from './middleware'
import { OutgoingContext } from './outgoing-context'

/**
 * Middleware for one or more of the bus' stages, registered with `Bus.configure().withMiddleware()`. Within each
 * stage, middleware runs in the order it was registered, with the first registered outermost.
 *
 * A plugin that keeps state should be a function that returns a new `BusMiddleware`, called once for each bus.
 * @example
 * const timing: BusMiddleware = {
 *   incoming: async (context, next) => {
 *     const started = Date.now()
 *     await next()
 *     console.log(`${context.message.$name} handled in ${Date.now() - started}ms`)
 *   },
 *   outgoing: async (context, next) => {
 *     context.attributes.attributes.sentFrom = 'orders-service'
 *     await next()
 *   }
 * }
 *
 * Bus.configure().withMiddleware(timing)
 */
export interface BusMiddleware {
  /**
   * Wraps the handling of each received message, around all of its handlers.
   *
   * Not calling `next()` skips the handlers, and the message is deleted. A throw, or an error let through from
   * `next()`, hands the message to the recoverability policy to retry or dead-letter; catching it without rethrowing
   * marks the message handled.
   */
  incoming?: Middleware<IncomingContext>

  /**
   * Wraps each call of a handler or workflow handler, inside its outbox. For a workflow, that's loading the state,
   * calling the handler and saving the state.
   *
   * Not calling `next()` skips that handler, which counts as succeeded. A throw fails that handler only: its sends
   * are dropped and the recoverability policy retries or dead-letters the message, as when a handler throws.
   */
  handler?: Middleware<HandlerInvocationContext>

  /**
   * Wraps each `send()` and `publish()`. It runs when they're called, before the message is buffered in a handler's
   * outbox, so it isn't run again when the outbox is flushed.
   *
   * Not calling `next()` drops the message. A throw rejects the `send()` or `publish()`, and nothing is buffered.
   */
  outgoing?: Middleware<OutgoingContext>
}

/**
 * The name of a middleware stage
 */
export type MiddlewareStage = keyof BusMiddleware
