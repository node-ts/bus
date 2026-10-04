import { Event } from '@node-ts/bus-messages'
import { AsyncLocalStorage } from 'node:async_hooks'
import { once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  OutgoingContext,
  OutgoingMessageDropped,
  OutgoingMessageDropReason
} from '../middleware'
import { OutgoingMessage } from '../outgoing-message'
import { deadLetter, FAILURE_HEADER, retry } from '../recoverability'
import {
  RecordingInMemoryQueue,
  TestCommand,
  TestEvent,
  testMessageTypes
} from '../test'
import { DEFAULT_IN_MEMORY_ENDPOINT_NAME } from '../transport'
import { InMemoryPersistence } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

const silentLogger = () => Mock.ofType<Logger>().object

class TransportUnavailable extends Error {}
class HandlerFailed extends Error {}
class MessageInvalid extends Error {}

/**
 * Records the ids of each batch the bus asks it to store, and reports no duplicates, as a store that can't tell a
 * repeated id within a batch from a new one would
 */
class BatchRecordingPersistence extends InMemoryPersistence {
  readonly storedIds: string[][] = []

  async storeOutgoingMessages(
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    this.storedIds.push(outgoingMessages.map(({ id }) => id))
    await super.storeOutgoingMessages(outgoingMessages)
    return []
  }
}

/**
 * Fails the first event it's asked to publish straight away, and takes a while to publish the second
 */
class SlowSecondPublishQueue extends RecordingInMemoryQueue {
  private publishes = 0

  constructor(private readonly calls: string[]) {
    super(() => undefined)
  }

  async publish<TEvent extends Event>(event: TEvent): Promise<void> {
    this.publishes++
    if (this.publishes === 1) {
      this.calls.push('first failed')
      throw new TransportUnavailable('broker unavailable')
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    await super.publish(event)
    this.calls.push('second sent')
  }
}

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
        .withRecoverability(() => retry(0))
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

  describe.each([
    { action: 'fails', settleWith: 'failMessage' as const },
    { action: 'returns', settleWith: 'returnMessage' as const }
  ])(
    'when a handler sends a message and then $action the message it is handling',
    ({ settleWith }) => {
      let bus: BusInstance
      const transported: string[] = []
      let settlement: Promise<Settlement> | undefined

      beforeAll(async () => {
        const queue = new RecordingInMemoryQueue(message =>
          transported.push(message.$name)
        )
        bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withLogger(silentLogger)
          .withTransport(queue)
          // Dead-letters a returned message, so the test sees one attempt
          .withRecoverability(() => deadLetter())
          .withHandler(
            handlerFor(TestCommand, async (_m, _a, ctx) => {
              await ctx.publish(new TestEvent())
              await ctx[settleWith]()
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
        const deadLettered = once(queue.settled, 'failed')
        await bus.send(new TestCommand())
        await deadLettered
      })

      afterAll(async () => {
        await bus.dispose()
      })

      it('should reject with OutgoingMessageDropped', async () => {
        const result = (await settlement)!
        expect(result).toEqual({
          resolved: false,
          error: expect.objectContaining({
            reason: OutgoingMessageDropReason.MessageFailedOrReturned
          })
        })
      })

      it('should not send it', () => {
        expect(transported).not.toContain(TestEvent.NAME)
      })
    }
  )

  describe.each([
    {
      when: 'a later outgoing middleware throws before next()',
      reject: (context: OutgoingContext) => {
        throw new MessageInvalid(context.message.$name)
      },
      causeType: 'MessageInvalid'
    },
    {
      when: 'a later outgoing middleware sets a reserved header',
      reject: (context: OutgoingContext) => {
        context.headers[FAILURE_HEADER] = 'forged'
      },
      causeType: 'TransportHeaderReserved'
    }
  ])('when $when', ({ reject, causeType }) => {
    let bus: BusInstance
    const transported: string[] = []
    let settlement: Promise<Settlement>
    let sendError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(message => transported.push(message.$name))
        )
        .withMiddleware(
          {
            outgoing: async (context, next) => {
              settlement = settlementOf(context)
              await next()
            }
          },
          {
            outgoing: async (context, next) => {
              reject(context)
              await next()
            }
          }
        )
        .build()
      await bus.initialize()
      sendError = await bus
        .publish(new TestEvent())
        .catch((error: unknown) => error)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject the publish with the error', () => {
      expect((sendError as Error).constructor.name).toEqual(causeType)
    })

    it('should reject dispatched with OutgoingMessageDropped, with the error as its cause', async () => {
      const result = await settlement
      expect(result.resolved).toBe(false)
      const { error } = result as { error: OutgoingMessageDropped }
      expect(error).toBeInstanceOf(OutgoingMessageDropped)
      expect(error.reason).toEqual(OutgoingMessageDropReason.Rejected)
      expect(error.cause).toBe(sendError)
    })

    it('should not send it', () => {
      expect(transported).toEqual([])
    })
  })

  describe('when an outgoing middleware throws after next() inside a handler', () => {
    let bus: BusInstance
    const transported: string[] = []
    let settlement: Promise<Settlement> | undefined
    const middlewareError = new MessageInvalid(TestEvent.NAME)

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message =>
        transported.push(message.$name)
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) =>
            ctx.publish(new TestEvent()).catch(() => undefined)
          )
        )
        .withMiddleware(
          {
            outgoing: async (context, next) => {
              if (context.message.$name === TestEvent.NAME) {
                settlement ??= settlementOf(context)
              }
              await next()
            }
          },
          {
            outgoing: async (context, next) => {
              await next()
              if (context.message.$name === TestEvent.NAME) {
                throw middlewareError
              }
            }
          }
        )
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

    it('should take it back out of the outbox and reject dispatched as rejected', async () => {
      expect(await settlement).toEqual({
        resolved: false,
        error: expect.objectContaining({
          reason: OutgoingMessageDropReason.Rejected,
          cause: middlewareError
        })
      })
      expect(transported).not.toContain(TestEvent.NAME)
    })
  })

  describe('when a handler sends a message after it failed the message it was handling', () => {
    let bus: BusInstance
    const lateSettlement = Promise.withResolvers<Settlement>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.failMessage()
            // Not awaited, so it's sent after the outbox was discarded
            setTimeout(() => {
              ctx.publish(new TestEvent()).catch(() => undefined)
            }, 20)
          })
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              lateSettlement.resolve(settlementOf(context))
            }
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop it as message-failed-or-returned', async () => {
      expect(await lateSettlement.promise).toEqual({
        resolved: false,
        error: expect.objectContaining({
          reason: OutgoingMessageDropReason.MessageFailedOrReturned
        })
      })
    })
  })

  describe('when every worker fails to send while flushing a large outbox', () => {
    let bus: BusInstance
    const transportError = new TransportUnavailable('broker unavailable')
    const settlements: Promise<Settlement>[] = []

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message => {
        if (message.$name === TestEvent.NAME) {
          throw transportError
        }
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            // One more message than the flush has workers, so one is left when they've all failed
            for (let i = 0; i < 11; i++) {
              await ctx.publish(new TestEvent())
            }
          })
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
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject the messages the workers tried with the transport error', async () => {
      const results = await Promise.all(settlements)
      expect(
        results.filter(
          result => !result.resolved && result.error === transportError
        )
      ).toHaveLength(10)
    })

    it('should drop the message no worker tried as outbox-flush-failed', async () => {
      const results = await Promise.all(settlements)
      expect(
        results.filter(
          result =>
            !result.resolved &&
            (result.error as OutgoingMessageDropped).reason ===
              OutgoingMessageDropReason.OutboxFlushFailed
        )
      ).toHaveLength(1)
    })
  })

  describe('when one message in an outbox fails to send while another is still sending', () => {
    let bus: BusInstance
    const calls: string[] = []

    beforeAll(async () => {
      const queue = new SlowSecondPublishQueue(calls)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent())
            await ctx.publish(new TestEvent())
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await failed
      calls.push('dead-lettered')
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should wait for the other send to finish before failing the handler', () => {
      expect(calls).toEqual(['first failed', 'second sent', 'dead-lettered'])
    })
  })

  describe('when a message is published with deliverAfter outside a handler', () => {
    let bus: BusInstance
    const transported: string[] = []
    let settlement: Promise<Settlement>

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(message => transported.push(message.$name))
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            settlement = settlementOf(context)
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.publish(new TestEvent(), { deliverAfter: 60_000 })
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should resolve once it is stored, before it reaches the transport', async () => {
      expect(await settlement).toEqual({ resolved: true })
      expect(transported).toEqual([])
    })
  })

  describe('when a handler publishes a message with deliverAfter', () => {
    let bus: BusInstance
    const calls: string[] = []

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message =>
        calls.push(`transport:${message.$name}`)
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent(), { deliverAfter: 60_000 })
            calls.push('handler resolved')
          })
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              void context.dispatched.then(() => calls.push('dispatched'))
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

    it('should resolve once the outbox stores it, after the handler resolves', () => {
      expect(calls.filter(call => !call.includes(TestCommand.NAME))).toEqual([
        'handler resolved',
        'dispatched'
      ])
    })
  })

  describe('when a handler replies', () => {
    let bus: BusInstance
    const calls: string[] = []

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        (message, _attributes, _options, address) =>
          calls.push(`transport:${message.$name}:${address ?? 'topic'}`)
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.reply(new TestEvent())
            calls.push('handler resolved')
          })
        )
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.kind === 'reply') {
              void context.dispatched.then(() => calls.push('dispatched'))
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

    it('should resolve once the reply is sent to the return address', () => {
      expect(calls.filter(call => !call.includes(TestCommand.NAME))).toEqual([
        'handler resolved',
        `transport:${TestEvent.NAME}:${DEFAULT_IN_MEMORY_ENDPOINT_NAME}`,
        'dispatched'
      ])
    })
  })

  describe('when two messages are published with deliverAfter and the same messageId', () => {
    let bus: BusInstance
    const settlements: Promise<Settlement>[] = []

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware({
          outgoing: async (context, next) => {
            settlements.push(settlementOf(context))
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.publish(new TestEvent(), {
        messageId: 'dup',
        deliverAfter: 60_000
      })
      await bus.publish(new TestEvent(), {
        messageId: 'dup',
        deliverAfter: 60_000
      })
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should resolve the first, which is stored', async () => {
      expect(await settlements[0]).toEqual({ resolved: true })
    })

    it('should reject the second as a duplicate, since the store skipped it', async () => {
      expect(await settlements[1]).toEqual({
        resolved: false,
        error: expect.objectContaining({
          reason: OutgoingMessageDropReason.Duplicate
        })
      })
    })
  })

  describe('when a handler publishes two messages with deliverAfter and the same messageId', () => {
    let bus: BusInstance
    const settlements: Promise<Settlement>[] = []
    const persistence = new BatchRecordingPersistence()
    const logger = Mock.ofType<Logger>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent(), {
              messageId: 'outbox-dup',
              deliverAfter: 60_000
            })
            await ctx.publish(new TestEvent(), {
              messageId: 'outbox-dup',
              deliverAfter: 60_000
            })
          })
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
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should only give the store the first, so it needs no way to report an id repeated in one batch', () => {
      expect(persistence.storedIds).toEqual([['outbox-dup']])
    })

    it('should warn that the repeated message was not stored, naming its id', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message =>
              message.startsWith('Scheduled messages were not stored')
            ),
            It.isObjectWith({ duplicateIds: ['outbox-dup'] })
          ),
        Times.once()
      )
    })

    it('should store the first and reject the second as a duplicate', async () => {
      expect(await Promise.all(settlements)).toEqual([
        { resolved: true },
        {
          resolved: false,
          error: expect.objectContaining({
            reason: OutgoingMessageDropReason.Duplicate
          })
        }
      ])
    })
  })

  describe('when a message is published with deliverAt', () => {
    let bus: BusInstance
    const dueAt = new Date(Date.now() + 60_000)
    let contextDueAt: Date | undefined
    let immediateDueAt: Date | undefined = new Date()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware({
          outgoing: async (context, next) => {
            const due = context.kind === 'reply' ? undefined : context.dueAt
            if (context.attributes.messageId === 'later') {
              contextDueAt = due
            } else {
              immediateDueAt = due
            }
            await next()
          }
        })
        .build()
      await bus.initialize()
      await bus.publish(new TestEvent(), {
        messageId: 'later',
        deliverAt: dueAt
      })
      await bus.publish(new TestEvent(), { messageId: 'now' })
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should give outgoing middleware when it is due', () => {
      expect(contextDueAt).toEqual(dueAt)
    })

    it('should leave dueAt undefined for a message sent now', () => {
      expect(immediateDueAt).toBeUndefined()
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
        .withRecoverability(() => retry(0))
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
