import { EventEmitter, once } from 'node:events'
import { IMock, It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { OutboxNotSupported } from '../outbox'
import { INBOX_RETENTION_MS } from '../outbox/inbox-retention'
import { deadLetter, retry } from '../recoverability'
import { testMessageTypes } from '../test'
import { TestCommand } from '../test/test-command'
import { InMemoryQueue } from '../transport'
import { sleep } from '../util'
import { InMemoryPersistence, PersistenceTransaction } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(20_000)

const silentLogger = () => Mock.ofType<Logger>().object

/**
 * An in-memory persistence that records what its inbox is asked, how its transactions end, and when old records are
 * removed, and can fail the next record
 */
class InboxPersistence extends InMemoryPersistence {
  recorded: { endpoint: string; messageId: string; recorded: boolean }[] = []
  removedBefore: Date[] = []
  readonly removals = new EventEmitter()
  commits = 0
  rollbacks = 0
  failNextRecord = false

  async beginTransaction(): Promise<PersistenceTransaction> {
    const transaction = await super.beginTransaction()
    return {
      ...transaction,
      recordIncomingMessage: async (endpoint, messageId) => {
        if (this.failNextRecord) {
          this.failNextRecord = false
          throw new Error('Inbox unavailable')
        }
        const recorded = await transaction.recordIncomingMessage(
          endpoint,
          messageId
        )
        this.recorded.push({ endpoint, messageId, recorded })
        return recorded
      },
      commit: async () => {
        await transaction.commit()
        this.commits++
      },
      rollback: async () => {
        await transaction.rollback()
        this.rollbacks++
      }
    }
  }

  async removeIncomingMessagesBefore(
    before: Date,
    limit: number
  ): Promise<number> {
    this.removedBefore.push(before)
    const removed = await super.removeIncomingMessagesBefore(before, limit)
    this.removals.emit('removed')
    return removed
  }
}

/**
 * Starts a bus with no random delay before its first inbox cleanup, which is otherwise up to five minutes
 */
const startWithoutCleanupJitter = async (bus: BusInstance): Promise<void> => {
  const random = jest.spyOn(Math, 'random').mockReturnValue(0)
  try {
    await bus.start()
  } finally {
    random.mockRestore()
  }
}

/**
 * Builds and starts a bus with withOutbox() that handles `TestCommand` with `handler`
 */
const startOutboxBus = async (
  persistence: InMemoryPersistence,
  queue: InMemoryQueue,
  handler: Parameters<typeof handlerFor<TestCommand>>[1],
  logger: Logger = silentLogger()
): Promise<BusInstance> => {
  const bus = Bus.configure()
    .withMessageTypes(testMessageTypes)
    .withLogger(() => logger)
    .withTransport(queue)
    .withPersistence(persistence)
    .withOutbox()
    .withRecoverability(({ failedAttempts }) =>
      failedAttempts < 2 ? retry(0) : deadLetter()
    )
    .withHandler(handlerFor(TestCommand, handler))
    .build()
  await bus.initialize()
  await bus.start()
  return bus
}

describe('BusInstance inbox', () => {
  describe("when withOutbox() is configured with a persistence that can't remove inbox records", () => {
    let error: unknown

    beforeAll(() => {
      const persistence = Object.assign(new InMemoryPersistence(), {
        removeIncomingMessagesBefore: undefined
      })
      try {
        Bus.configure()
          .withLogger(silentLogger)
          .withPersistence(persistence)
          .withOutbox()
          .build()
      } catch (e) {
        error = e
      }
    })

    it('should throw OutboxNotSupported naming the method to implement', () => {
      expect(error).toBeInstanceOf(OutboxNotSupported)
      expect((error as OutboxNotSupported).help).toContain(
        'removeIncomingMessagesBefore()'
      )
    })
  })

  describe('when a message is delivered again after it was handled', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue({
      endpointName: 'inbox-endpoint',
      receiveTimeoutMs: 100
    })
    const handled = Mock.ofType<(command: TestCommand) => void>()
    const handlerMiddlewareRuns: string[] = []
    const incomingMiddlewareRuns: string[] = []
    const messageId = 'repeated-message-id'

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withMiddleware({
          incoming: async (context, next) => {
            incomingMiddlewareRuns.push(context.attributes.messageId!)
            await next()
          },
          handler: async (context, next) => {
            handlerMiddlewareRuns.push(context.attributes.messageId!)
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, m => handled.object(m)))
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should run its handlers once', () => {
      handled.verify(h => h(It.isAny()), Times.once())
    })

    it('should record it in the inbox with the endpoint and messageId', () => {
      expect(persistence.recorded).toEqual([
        { endpoint: 'inbox-endpoint', messageId, recorded: true },
        { endpoint: 'inbox-endpoint', messageId, recorded: false }
      ])
    })

    it('should still run the incoming middleware for the copy', () => {
      expect(incomingMiddlewareRuns).toEqual([messageId, messageId])
    })

    it('should not run the handler middleware for the copy', () => {
      expect(handlerMiddlewareRuns).toEqual([messageId])
    })

    it('should end the transaction of each', () => {
      expect(persistence.commits + persistence.rollbacks).toEqual(2)
    })

    it('should delete the copy rather than retry or dead-letter it', () => {
      expect(queue.depth).toEqual(0)
      expect(queue.deadLetterQueueDepth).toEqual(0)
    })
  })

  describe('when a message has no messageId', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue()
    const handled = Mock.ofType<(command: TestCommand) => void>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withHandler(handlerFor(TestCommand, m => handled.object(m)))
        .build()
      await bus.initialize()
      await bus.start()
      // Straight onto the transport, as a message from outside the bus would arrive
      const attributes = { attributes: {}, stickyAttributes: {} }
      await queue.send(new TestCommand(), attributes)
      await queue.send(new TestCommand(), attributes)
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should handle each copy', () => {
      handled.verify(h => h(It.isAny()), Times.exactly(2))
    })

    it('should not record it in the inbox', () => {
      expect(persistence.recorded).toEqual([])
    })
  })

  describe('when the inbox fails to record a message', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue()
    const handled = Mock.ofType<(command: TestCommand) => void>()

    beforeAll(async () => {
      persistence.failNextRecord = true
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withRecoverability(() => retry(0))
        .withHandler(handlerFor(TestCommand, m => handled.object(m)))
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should not run the handlers until it is recorded', () => {
      handled.verify(h => h(It.isAny()), Times.once())
    })

    it('should roll back the transaction it failed in', () => {
      expect(persistence.rollbacks).toEqual(1)
      expect(persistence.commits).toEqual(1)
    })
  })

  describe('when a handler calls failMessage()', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue({ receiveTimeoutMs: 100 })
    const messageId = 'failed-message-id'
    let attempts = 0

    beforeAll(async () => {
      bus = await startOutboxBus(persistence, queue, async (_m, _a, ctx) => {
        if (++attempts === 1) {
          await ctx.failMessage()
        }
      })
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
      // Replayed from the dead letter queue with the same messageId
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should roll back its inbox record, so the replay is handled', () => {
      expect(attempts).toEqual(2)
      expect(persistence.recorded.map(({ recorded }) => recorded)).toEqual([
        true,
        true
      ])
    })
  })

  describe('when a handler calls returnMessage()', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue({ receiveTimeoutMs: 100 })
    let attempts = 0

    beforeAll(async () => {
      bus = await startOutboxBus(persistence, queue, async (_m, _a, ctx) => {
        if (++attempts === 1) {
          await ctx.returnMessage()
        }
      })
      await bus.send(new TestCommand())
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should roll back its inbox record, so the retry is handled', () => {
      expect(attempts).toEqual(2)
      expect(persistence.recorded.map(({ recorded }) => recorded)).toEqual([
        true,
        true
      ])
    })
  })

  describe('when incoming middleware calls failMessage() after next()', () => {
    let bus: BusInstance
    let logger: IMock<Logger>
    const persistence = new InboxPersistence()
    const queue = new InMemoryQueue({ receiveTimeoutMs: 100 })
    const messageId = 'late-failed-message-id'
    let attempts = 0
    let isFirst = true

    beforeAll(async () => {
      logger = Mock.ofType<Logger>()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withMiddleware({
          incoming: async (_context, next) => {
            await next()
            if (isFirst) {
              isFirst = false
              await bus.failMessage()
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, () => {
            attempts++
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
      // Replayed from the dead letter queue with the same messageId
      await bus.send(new TestCommand(), { messageId })
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should dead-letter the message', () => {
      expect(queue.deadLetterQueueDepth).toEqual(1)
    })

    it('should keep its inbox record, so the replay is skipped', () => {
      expect(attempts).toEqual(1)
    })

    it('should warn that the replay will be skipped', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(
              m =>
                m.startsWith('failMessage() was called after') &&
                m.includes('skipped as already handled')
            ),
            It.isObjectWith({ messageId })
          ),
        Times.once()
      )
    })
  })

  describe('when a bus with withOutbox() is started', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()
    let startedAt: number

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .withOutbox()
        .build()
      await bus.initialize()
      const removed = once(persistence.removals, 'removed')
      startedAt = Date.now()
      await startWithoutCleanupJitter(bus)
      await removed
      await bus.stop()
    })

    afterAll(async () => bus.dispose())

    it('should remove inbox records older than the retention period', () => {
      expect(persistence.removedBefore).toHaveLength(1)
      const removedBefore = persistence.removedBefore[0].getTime()
      expect(removedBefore).toBeGreaterThanOrEqual(
        startedAt - INBOX_RETENTION_MS
      )
      expect(removedBefore).toBeLessThanOrEqual(Date.now() - INBOX_RETENTION_MS)
    })
  })

  describe('when a scheduler without withOutbox() is started', () => {
    let bus: BusInstance
    const persistence = new InboxPersistence()

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .asScheduler()
        .build()
      await bus.initialize()
      const removed = once(persistence.removals, 'removed')
      await startWithoutCleanupJitter(bus)
      await removed
      await bus.stop()
    })

    afterAll(async () => bus.dispose())

    it('should remove the old inbox records of the buses that share its persistence', () => {
      expect(persistence.removedBefore).toHaveLength(1)
    })
  })

  describe('when a bus that would not clean up the inbox is started', () => {
    const buses: BusInstance[] = []
    const persistences = {
      withoutOutbox: new InboxPersistence(),
      dispatchOff: new InboxPersistence()
    }

    beforeAll(async () => {
      buses.push(
        Bus.configure()
          .withLogger(silentLogger)
          .withPersistence(persistences.withoutOutbox)
          .build(),
        Bus.configure()
          .withLogger(silentLogger)
          .withPersistence(persistences.dispatchOff)
          .withOutbox()
          .withDelayedDelivery({ dispatch: false })
          .build()
      )
      for (const bus of buses) {
        await bus.initialize()
        await startWithoutCleanupJitter(bus)
      }
      // With no jitter, a cleanup would have run straight away
      await sleep(50)
      for (const bus of buses) {
        await bus.stop()
      }
    })

    afterAll(async () => {
      for (const bus of buses) {
        await bus.dispose()
      }
    })

    it('should leave it to a bus with withOutbox(), or a scheduler, when it has no withOutbox()', () => {
      expect(persistences.withoutOutbox.removedBefore).toEqual([])
    })

    it('should leave it to a bus that dispatches when its dispatching is turned off', () => {
      expect(persistences.dispatchOff.removedBefore).toEqual([])
    })
  })
})
