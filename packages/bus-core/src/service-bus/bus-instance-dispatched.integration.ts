import { AsyncLocalStorage } from 'node:async_hooks'
import { once } from 'node:events'
import { Mock } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  OutgoingContext,
  OutgoingMessageDropped,
  OutgoingMessageDropReason
} from '../middleware'
import {
  RecordingInMemoryQueue,
  TestCommand,
  TestEvent,
  testMessageTypes
} from '../test'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

const silentLogger = () => Mock.ofType<Logger>().object

class TransportUnavailable extends Error {}
class HandlerFailed extends Error {}

/**
 * How a message's `dispatched` promise settled
 */
type Settlement = { resolved: true } | { resolved: false; error: unknown }

const settlementOf = async (context: OutgoingContext): Promise<Settlement> =>
  context.dispatched.then(
    () => ({ resolved: true }) as const,
    (error: unknown) => ({ resolved: false, error }) as const
  )

describe('BusInstance dispatched', () => {
  describe('when a message is sent outside a handler', () => {
    let bus: BusInstance
    const calls: string[] = []
    let settlement: Promise<Settlement>

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(message =>
            calls.push(`transport:${message.$name}`)
          )
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            settlement = settlementOf(context)
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.publish(new TestEvent())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should resolve once the transport has the message', async () => {
      expect(await settlement).toEqual({ resolved: true })
      expect(calls).toEqual([`transport:${TestEvent.NAME}`])
    })
  })

  describe('when a handler sends a message', () => {
    let bus: BusInstance
    const calls: string[] = []
    const sendContext = new AsyncLocalStorage<string>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message =>
        calls.push(
          `transport:${message.$name}:${sendContext.getStore() ?? 'none'}`
        )
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent())
            calls.push('handler resolved')
          })
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              void context.dispatched.then(() => calls.push('dispatched'))
              await sendContext.run('send span', next)
              return
            }
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should resolve once the outbox sends it, after the handler resolves', () => {
      expect(calls.filter(call => !call.includes(TestCommand.NAME))).toEqual([
        'handler resolved',
        `transport:${TestEvent.NAME}:send span`,
        'dispatched'
      ])
    })

    it('should send it in the async context next() was called in', () => {
      expect(calls).toContain(`transport:${TestEvent.NAME}:send span`)
    })
  })

  describe('when the handler fails after sending a message', () => {
    let bus: BusInstance
    const transported: string[] = []
    let settlement: Promise<Settlement> | undefined
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason)

    beforeAll(async () => {
      process.on('unhandledRejection', onUnhandledRejection)
      let attempts = 0
      const queue = new RecordingInMemoryQueue(message =>
        transported.push(message.$name)
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withRetryStrategy({ calculateRetryDelay: () => 0 })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            // The second attempt's event isn't observed, to check its rejection isn't reported as unhandled
            await ctx.publish(new TestEvent())
            attempts++
            throw new HandlerFailed(`attempt ${attempts}`)
          })
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              settlement ??= settlementOf(context)
            }
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      const returnedTwice = new Promise<void>(resolve => {
        let returns = 0
        queue.settled.on('returned', () => ++returns === 2 && resolve())
      })
      await bus.send(new TestCommand())
      await returnedTwice
      await bus.stop()
      // Gives Node a turn to report unhandled rejections
      await new Promise(resolve => setImmediate(resolve))
    })

    afterAll(async () => {
      process.off('unhandledRejection', onUnhandledRejection)
      await bus.dispose()
    })

    it('should reject with OutgoingMessageDropped', async () => {
      const result = (await settlement)!
      expect(result.resolved).toBe(false)
      const { error } = result as { error: OutgoingMessageDropped }
      expect(error).toBeInstanceOf(OutgoingMessageDropped)
      expect(error.reason).toEqual(OutgoingMessageDropReason.HandlerFailed)
      expect(error.messageName).toEqual(TestEvent.NAME)
    })

    it('should not send it', () => {
      expect(transported).not.toContain(TestEvent.NAME)
    })

    it('should not report a rejection nobody observed as unhandled', () => {
      expect(unhandledRejections).toEqual([])
    })
  })

  describe('when outgoing middleware does not call next()', () => {
    let bus: BusInstance
    let settlement: Promise<Settlement>

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware(
          {
            outgoing: async (context, next) => {
              settlement = settlementOf(context)
              await next()
            }
          },
          { outgoing: async () => undefined }
        )
        .build()
      await bus.initialize()
      await bus.publish(new TestEvent())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject with OutgoingMessageDropped', async () => {
      const result = await settlement
      expect(result).toEqual({
        resolved: false,
        error: expect.objectContaining({
          reason: OutgoingMessageDropReason.MiddlewareSkipped
        })
      })
    })
  })

  describe('when the transport fails to send a message from the outbox', () => {
    let bus: BusInstance
    const transportError = new TransportUnavailable('broker unavailable')
    const settlements: Promise<Settlement>[] = []

    beforeAll(async () => {
      let failed = false
      const queue = new RecordingInMemoryQueue(message => {
        if (message.$name === TestEvent.NAME && !failed) {
          failed = true
          throw transportError
        }
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withRetryStrategy({ calculateRetryDelay: () => 0 })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) =>
            ctx.publish(new TestEvent())
          )
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              settlements.push(settlementOf(context))
            }
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      const returned = once(queue.settled, 'returned')
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await returned
      await deleted
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject with the transport error', async () => {
      expect(await settlements[0]).toEqual({
        resolved: false,
        error: transportError
      })
    })

    it('should resolve when the retried handler sends it', async () => {
      expect(await settlements[1]).toEqual({ resolved: true })
    })
  })
})
