/**
 * Runs the rest of a middleware chain: the next middleware of the stage, or once there are none left, the step
 * the stage wraps. It can be called at most once.
 * @returns a promise that resolves once the rest of the chain has finished, and rejects with its error
 * @throws MiddlewareNextCalledTwice if it's called a second time
 */
export type Next = () => Promise<void>

/**
 * A step in one of the bus' middleware stages. It gets the context of the stage and `next`, and decides whether
 * and when the rest of the chain runs by calling `next()` at most once:
 * - code before `await next()` runs before the rest of the chain, and code after it runs once the rest has finished
 * - not calling `next()` short-circuits the stage, which then counts as handled
 * - throwing, or letting an error from `next()` through, fails the stage
 *
 * It returns a promise so that a `next()` call that isn't awaited or returned doesn't compile.
 * @param context the context of the stage
 * @param next runs the rest of the chain
 * @returns a promise that resolves once the middleware is done
 * @example
 * const timeHandlers: Middleware<IncomingContext> = async (context, next) => {
 *   const started = Date.now()
 *   await next()
 *   console.log(`${context.message.$name} took ${Date.now() - started}ms`)
 * }
 */
export type Middleware<TContext> = (
  context: TContext,
  next: Next
) => Promise<void>
