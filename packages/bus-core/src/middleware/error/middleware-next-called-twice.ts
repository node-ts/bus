import { MiddlewareStage } from '../bus-middleware'

/**
 * Thrown when a middleware calls `next()` more than once, which would run the rest of the chain again
 */
export class MiddlewareNextCalledTwice extends Error {
  readonly help: string

  /**
   * @param stage the stage of the middleware that called `next()` again
   */
  constructor(readonly stage: MiddlewareStage) {
    super(`next() was called more than once by ${stage} middleware`)
    this.help = `Call next() at most once in each ${stage} middleware. To have a failed message retried, throw instead and let the bus retry it.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
