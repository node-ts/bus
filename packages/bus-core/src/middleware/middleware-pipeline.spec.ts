import { MessageAttributes } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { TestCommand, TestEvent } from '../test'
import { BusMiddleware, MiddlewareStage } from './bus-middleware'
import { MiddlewareNextCalledTwice } from './error'
import { HandlerInvocationContext } from './handler-invocation-context'
import { IncomingContext } from './incoming-context'
import { Middleware } from './middleware'
import { MiddlewarePipeline } from './middleware-pipeline'
import { OutgoingContext } from './outgoing-context'

const attributes: MessageAttributes = {
  correlationId: 'correlation-id',
  attributes: {},
  stickyAttributes: {}
}

const incomingContext: IncomingContext = {
  correlationId: attributes.correlationId,
  message: new TestCommand(),
  attributes,
  transportMessage: {
    id: '1',
    domainMessage: new TestCommand(),
    attributes,
    raw: {},
    failedAttempts: 0
  },
  send: async () => undefined,
  publish: async () => undefined,
  failMessage: async () => undefined,
  returnMessage: async () => undefined
}

const handlerContext: HandlerInvocationContext = {
  ...incomingContext,
  handlerName: 'placeOrder'
}

const outgoingContext = (): OutgoingContext => ({
  kind: 'publish',
  message: new TestEvent(),
  attributes: { attributes: {}, stickyAttributes: {} },
  headers: {}
})

/**
 * Stamps every outgoing message with the tenant it was sent for, as an app might
 */
const stampTenant =
  (tenantId: string): Middleware<OutgoingContext> =>
  async (context, next) => {
    context.attributes.attributes.tenantId = tenantId
    context.headers['x-tenant'] = tenantId
    await next()
  }

describe('MiddlewarePipeline', () => {
  describe('when a middleware is called as a plain function', () => {
    const context = outgoingContext()
    let nextCalls = 0

    beforeAll(async () => {
      await stampTenant('acme')(context, async () => {
        nextCalls++
      })
    })

    it('should change the context', () => {
      expect(context.attributes.attributes.tenantId).toEqual('acme')
      expect(context.headers).toEqual({ 'x-tenant': 'acme' })
    })

    it('should call next', () => {
      expect(nextCalls).toEqual(1)
    })
  })

  describe('when middleware is registered for several stages', () => {
    const calls: string[] = []
    const record =
      <TContext>(name: string): Middleware<TContext> =>
      async (_, next) => {
        calls.push(`${name}:before`)
        await next()
        calls.push(`${name}:after`)
      }

    beforeAll(async () => {
      const sut = new MiddlewarePipeline([
        { incoming: record('incoming-1'), outgoing: record('outgoing-1') },
        { handler: record('handler-1') },
        { incoming: record('incoming-2'), handler: record('handler-2') }
      ])
      await sut.runIncoming(incomingContext, async () => {
        calls.push('dispatch')
      })
      await sut.runHandler(handlerContext, async () => {
        calls.push('invoke')
      })
      await sut.runOutgoing(outgoingContext(), async () => {
        calls.push('send')
      })
    })

    it('should run each stage in registration order with the first outermost', () => {
      expect(calls).toEqual([
        'incoming-1:before',
        'incoming-2:before',
        'dispatch',
        'incoming-2:after',
        'incoming-1:after',
        'handler-1:before',
        'handler-2:before',
        'invoke',
        'handler-2:after',
        'handler-1:after',
        'outgoing-1:before',
        'send',
        'outgoing-1:after'
      ])
    })
  })

  describe('when no middleware is registered', () => {
    let terminal: IMock<() => Promise<void>>

    beforeAll(async () => {
      terminal = Mock.ofType<() => Promise<void>>()
      terminal.setup(t => t()).returns(async () => undefined)
      const sut = new MiddlewarePipeline()
      await sut.runOutgoing(outgoingContext(), terminal.object)
    })

    it('should run the terminal step', () => {
      terminal.verify(t => t(), Times.once())
    })
  })

  describe('when a middleware does not call next()', () => {
    let terminal: IMock<() => Promise<void>>
    let inner: IMock<Middleware<IncomingContext>>

    beforeAll(async () => {
      terminal = Mock.ofType<() => Promise<void>>()
      inner = Mock.ofType<Middleware<IncomingContext>>()
      const sut = new MiddlewarePipeline([
        { incoming: async () => undefined },
        { incoming: inner.object }
      ])
      await sut.runIncoming(incomingContext, terminal.object)
    })

    it('should not run the rest of the chain', () => {
      inner.verify(m => m(It.isAny(), It.isAny()), Times.never())
      terminal.verify(t => t(), Times.never())
    })
  })

  describe('when the terminal step throws', () => {
    const terminalError = new Error('Handler failed')
    let caught: unknown
    let error: unknown

    beforeAll(async () => {
      const sut = new MiddlewarePipeline([
        {
          handler: async (_, next) => {
            try {
              await next()
            } catch (e) {
              caught = e
              throw e
            }
          }
        }
      ])
      error = await sut
        .runHandler(handlerContext, async () => {
          throw terminalError
        })
        .catch(e => e)
    })

    it('should pass the error to the middleware', () => {
      expect(caught).toBe(terminalError)
    })

    it('should reject with the error the middleware lets through', () => {
      expect(error).toBe(terminalError)
    })
  })

  describe('when a middleware calls next() twice', () => {
    const stages: MiddlewareStage[] = ['incoming', 'handler', 'outgoing']

    describe.each(stages)('in the %s stage', stage => {
      let terminalCalls = 0
      let error: unknown

      beforeAll(async () => {
        const twice: Middleware<unknown> = async (_, next) => {
          await next()
          await next()
        }
        const sut = new MiddlewarePipeline([
          { [stage]: twice } as BusMiddleware
        ])
        const terminal = async () => {
          terminalCalls++
        }
        error = await (
          stage === 'incoming'
            ? sut.runIncoming(incomingContext, terminal)
            : stage === 'handler'
              ? sut.runHandler(handlerContext, terminal)
              : sut.runOutgoing(outgoingContext(), terminal)
        ).catch(e => e)
      })

      it('should throw MiddlewareNextCalledTwice naming the stage', () => {
        expect(error).toBeInstanceOf(MiddlewareNextCalledTwice)
        expect((error as MiddlewareNextCalledTwice).stage).toEqual(stage)
      })

      it('should only run the rest of the chain once', () => {
        expect(terminalCalls).toEqual(1)
      })
    })
  })
})
