import { BusMiddleware, MiddlewareStage } from './bus-middleware'
import { MiddlewareNextCalledTwice } from './error'
import { HandlerInvocationContext } from './handler-invocation-context'
import { IncomingContext } from './incoming-context'
import { Middleware } from './middleware'
import { OutgoingContext } from './outgoing-context'

/**
 * Runs `middlewares` in order around `terminal`, the step the stage wraps, with the first outermost
 */
const runMiddleware = async <TContext>(
  stage: MiddlewareStage,
  middlewares: Middleware<TContext>[],
  context: TContext,
  terminal: () => Promise<void>
): Promise<void> => {
  const dispatch = async (index: number): Promise<void> => {
    if (index === middlewares.length) {
      return terminal()
    }
    let nextCalled = false
    await middlewares[index](context, async () => {
      if (nextCalled) {
        throw new MiddlewareNextCalledTwice(stage)
      }
      nextCalled = true
      await dispatch(index + 1)
    })
  }
  return dispatch(0)
}

/**
 * The middleware chains of one bus, built from what was passed to `withMiddleware()`. Internal, and never shared
 * between buses.
 */
export class MiddlewarePipeline {
  private readonly incoming: Middleware<IncomingContext>[]
  private readonly handler: Middleware<HandlerInvocationContext>[]
  private readonly outgoing: Middleware<OutgoingContext>[]

  /**
   * @param middleware the middleware of the bus, in the order it was registered
   */
  constructor(middleware: BusMiddleware[] = []) {
    this.incoming = middleware.flatMap(m => (m.incoming ? [m.incoming] : []))
    this.handler = middleware.flatMap(m => (m.handler ? [m.handler] : []))
    this.outgoing = middleware.flatMap(m => (m.outgoing ? [m.outgoing] : []))
  }

  /**
   * Runs the incoming middleware around dispatching a received message to its handlers
   * @param context the context of the received message
   * @param dispatch dispatches the message to its handlers
   */
  async runIncoming(
    context: IncomingContext,
    dispatch: () => Promise<void>
  ): Promise<void> {
    return runMiddleware('incoming', this.incoming, context, dispatch)
  }

  /**
   * Runs the handler middleware around one call of a handler
   * @param context the context of the handler call
   * @param invoke calls the handler
   */
  async runHandler(
    context: HandlerInvocationContext,
    invoke: () => Promise<void>
  ): Promise<void> {
    return runMiddleware('handler', this.handler, context, invoke)
  }

  /**
   * Runs the outgoing middleware around buffering or dispatching an outgoing message
   * @param context the context of the outgoing message
   * @param dispatch buffers the message in the outbox of the message being handled, or sends it to the transport
   */
  async runOutgoing(
    context: OutgoingContext,
    dispatch: () => Promise<void>
  ): Promise<void> {
    return runMiddleware('outgoing', this.outgoing, context, dispatch)
  }
}
