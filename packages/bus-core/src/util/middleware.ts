/**
 * This middleware pattern has been grabbed from here:
 * https://evertpot.com/generic-middleware/
 */

/**
 * 'next' function, passed to a middleware
 */
 export type Next = () => void | Promise<void>

/**
  * A middleware
  */
export type Middleware<T> =
  (context: T, next: Next) => Promise<void> | void

/**
 * A middleware container and invoker
 */
export class MiddlewareDispatcher<T> {

  middlewares: Middleware<T>[] = []

  constructor (
    readonly finalMiddlewares: Middleware<T>[] = []
  ) {
  }

  /**
   * Add a middleware function.
   */
  use(...middlewares: Middleware<T>[]): void {
    this.middlewares.push(...middlewares)
  }

  /**
   * Add 'final' middlewares that will be added to the end of the
   * regular middlewares. This allows for finer control when exposing
   * the @see use functionality to consumers but wanting to ensure that your
   * final middleware is last to run
   */
  useFinal(...middlewares: Middleware<T>[]): void {
    this.finalMiddlewares.push(...middlewares)
  }

  /**
   * Execute the chain of middlewares, in the order they were added on a
   * given Context.
   */
  dispatch(context: T): Promise<void> {
     return invokeMiddlewares(context, this.middlewares.concat(this.finalMiddlewares))
  }
}


async function invokeMiddlewares<T>(context: T, middlewares: Middleware<T>[]): Promise<void> {

  if (!middlewares.length) {
    return
  }

  const middleware = middlewares[0]

  return middleware(context, async () => {
    await invokeMiddlewares(context, middlewares.slice(1))
  })
}
