import { once } from 'node:events'
import { Mock } from 'typemoq'
import { HandlerContext, handlerFor } from '../handler'
import { Logger } from '../logger'
import { IncomingContext, RequestedSettlement } from '../middleware'
import { deadLetter } from '../recoverability'
import { RecordingInMemoryQueue, TestCommand, testMessageTypes } from '../test'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

const silentLogger = () => Mock.ofType<Logger>().object

describe('BusInstance requestedSettlement', () => {
  describe.each([
    {
      handler: 'calls failMessage()',
      settle: async (ctx: HandlerContext) => ctx.failMessage(),
      settledAs: 'failed',
      expected: RequestedSettlement.Failed
    },
    {
      handler: 'calls returnMessage()',
      settle: async (ctx: HandlerContext) => ctx.returnMessage(),
      settledAs: 'failed',
      expected: RequestedSettlement.Returned
    },
    {
      handler: 'calls both',
      settle: async (ctx: HandlerContext) => {
        await ctx.returnMessage()
        await ctx.failMessage()
      },
      settledAs: 'failed',
      expected: RequestedSettlement.Failed
    },
    {
      handler: 'resolves',
      settle: async () => undefined,
      settledAs: 'deleted',
      expected: undefined
    }
  ])('when a handler $handler', ({ settle, settledAs, expected }) => {
    let bus: BusInstance
    let beforeNext: RequestedSettlement | undefined
    let afterNext: RequestedSettlement | undefined
    let afterHandler: RequestedSettlement | undefined
    let afterSettled: RequestedSettlement | undefined
    let savedContext: IncomingContext | undefined

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        // Dead-letters a returned message, so it's handled once
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => settle(ctx))
        )
        .withMiddleware({
          incoming: async (context, next) => {
            savedContext = context
            beforeNext = context.requestedSettlement()
            await next()
            afterNext = context.requestedSettlement()
          },
          handler: async (context, next) => {
            await next()
            afterHandler = context.requestedSettlement()
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      const settled = once(queue.settled, settledAs)
      await bus.send(new TestCommand())
      await settled
      // Read outside the message's handling context, once it's been settled
      afterSettled = savedContext!.requestedSettlement()
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should be undefined before the handlers run', () => {
      expect(beforeNext).toBeUndefined()
    })

    it('should report how the message was asked to be settled after next() resolves', () => {
      expect(afterNext).toEqual(expected)
    })

    it('should report it to handler middleware too', () => {
      expect(afterHandler).toEqual(expected)
    })

    it("should still report that message's settlement when read later, outside its handling context", () => {
      expect(afterSettled).toEqual(expected)
    })
  })
})
