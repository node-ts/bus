/**
 * This middleware pattern has been grabbed from here:
 * https://evertpot.com/generic-middleware/
 */

/**
 * 'next' function, passed to a middleware
 */
 export type Next = () => void | Promise<void>;

/**
  * A middleware
  */
export type Middleware<T> =
  (context: T, next: Next) => Promise<void> | void

/**
 * A middleware container and invoker
 */
export class MiddlewareDispatcher<T> {

  middlewares: Middleware<T>[];

  constructor() {
    this.middlewares = [];
  }

  /**
   * Add a middleware function.
   */
  use(...middlewares: Middleware<T>[]): void {

    this.middlewares.push(...middlewares);

  }

  /**
   * Execute the chain of middlewares, in the order they were added on a
   * given Context.
   */
  dispatch(context: T): Promise<void> {
     return invokeMiddlewares(context, this.middlewares)
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
