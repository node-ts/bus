import {
  Bus,
  BusInstance,
  deadLetter,
  FAILURE_HEADER,
  handlerFor,
  InMemoryQueue,
  Logger,
  Persistence,
  PersistenceTransaction,
  retry,
  sleep,
  TransportHeaders
} from '@node-ts/bus-core'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import { messageTypes, TestOutboxCommand, TestOutboxEvent } from './helpers'

/**
 * How many times the suite's buses try a message before they dead-letter it
 */
const MAX_ATTEMPTS = 3

/**
 * The endpoints of the suite's two buses
 */
const FIRST_ENDPOINT = 'inbox-tests-first'
const SECOND_ENDPOINT = 'inbox-tests-second'

/**
 * How long the suite waits to see that recording a message is still waiting for another transaction
 */
const BLOCKED_FOR_MS = 200

const HOUR_MS = 60 * 60_000

/**
 * How long the handler of the first of two copies waits for the second to arrive
 */
const OVERLAP_TIMEOUT_MS = 5_000

/**
 * Whether a promise is still pending after `BLOCKED_FOR_MS`
 */
const isBlocked = async (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => false,
      () => false
    ),
    sleep(BLOCKED_FOR_MS).then(() => true)
  ])

/**
 * A suite that checks a persistence keeps the inbox of `withOutbox()`: a message is handled once by each endpoint
 * however many times it's delivered, two copies handled at once are never both handled, a message that failed leaves
 * no record so its retry or a replay from the dead letter queue is handled, and old records are removed.
 *
 * It records messages in the persistence's transactions directly, and runs two buses, on two endpoints, with
 * in-memory queues and handlers that fail on purpose. The buses provision with `bus.provision()`, then initialize
 * without provisioning, so `initialize()` only checks that what `provision()` created exists.
 * @param persistence A fully configured persistence that supports `withOutbox()`, on its own database or schema,
 * since the suite removes every inbox record in it. It's disposed when the suite's buses are disposed, unless another
 * bus that uses it is still running.
 */
export const inboxTests = (persistence: Persistence): void => {
  const events = new EventEmitter()
  const handledCommands: string[] = []
  /**
   * How many copies of each run's command have reached the incoming middleware, which runs before the inbox
   */
  const arrivals = new Map<string, number>()
  /**
   * Whether the handler of a run's first copy saw a second copy arrive while it ran
   */
  const overlapped = new Map<string, boolean>()
  const receivedEvents: string[] = []
  const runIdsThatFailedOnce = new Set<string>()
  const runIdsThatFail = new Set<string>()
  const firstQueue = new InMemoryQueue({
    endpointName: FIRST_ENDPOINT,
    receiveTimeoutMs: 100
  })
  const secondQueue = new InMemoryQueue({
    endpointName: SECOND_ENDPOINT,
    receiveTimeoutMs: 100
  })
  let firstBus: BusInstance
  let secondBus: BusInstance

  const beginTransaction = async (): Promise<PersistenceTransaction> => {
    if (!persistence.beginTransaction) {
      throw new Error(
        `${persistence.constructor.name} doesn't implement beginTransaction(), which inboxTests() needs`
      )
    }
    return persistence.beginTransaction()
  }

  const removeIncomingMessagesBefore = async (
    before: Date,
    limit: number
  ): Promise<number> => {
    if (!persistence.removeIncomingMessagesBefore) {
      throw new Error(
        `${persistence.constructor.name} doesn't implement removeIncomingMessagesBefore(), which inboxTests() needs`
      )
    }
    return persistence.removeIncomingMessagesBefore(before, limit)
  }

  /**
   * Records a message in a transaction of its own, which is committed
   */
  const recordCommitted = async (
    endpoint: string,
    messageId: string
  ): Promise<boolean> => {
    const transaction = await beginTransaction()
    const recorded = await transaction.recordIncomingMessage(
      endpoint,
      messageId
    )
    await transaction.commit()
    return recorded
  }

  /**
   * Resolves true once two copies of a run's command have arrived, or false after `OVERLAP_TIMEOUT_MS`
   */
  const secondCopyArrived = async (runId: string): Promise<boolean> => {
    if ((arrivals.get(runId) ?? 0) >= 2) {
      return true
    }
    let timeout: NodeJS.Timeout | undefined
    const arrived = await Promise.race([
      waitFor('second-copy-arrived', runId).then(() => true),
      new Promise<false>(resolve => {
        timeout = setTimeout(() => resolve(false), OVERLAP_TIMEOUT_MS)
      })
    ])
    clearTimeout(timeout)
    return arrived
  }

  /**
   * Resolves once `eventName` is emitted with a run id
   */
  const waitFor = async (eventName: string, runId: string): Promise<void> =>
    new Promise(resolve => {
      const listener = (emittedRunId: string) => {
        if (emittedRunId === runId) {
          events.off(eventName, listener)
          resolve()
        }
      }
      events.on(eventName, listener)
    })

  const timesHandled = (runId: string): number =>
    handledCommands.filter(id => id === runId).length

  const timesReceived = (endpoint: string, runId: string): number =>
    receivedEvents.filter(received => received === `${endpoint}:${runId}`)
      .length

  const buildBus = (queue: InMemoryQueue, endpoint: string) =>
    Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(messageTypes)
      .withTransport(queue)
      .withPersistence(persistence)
      .withOutbox()
      .withConcurrency(2)
      .withRecoverability(({ message, failedAttempts }) => {
        if (failedAttempts < MAX_ATTEMPTS) {
          return retry(0)
        }
        events.emit('dead-lettered', (message as TestOutboxCommand).runId)
        return deadLetter()
      })
      .withHandler(
        handlerFor(TestOutboxEvent, ({ runId }) => {
          receivedEvents.push(`${endpoint}:${runId}`)
        })
      )

  beforeAll(async () => {
    firstBus = buildBus(firstQueue, FIRST_ENDPOINT)
      .withMiddleware({
        incoming: async (context, next) => {
          const { runId } = context.message as TestOutboxCommand
          if (context.message.$name === TestOutboxCommand.NAME) {
            const count = (arrivals.get(runId) ?? 0) + 1
            arrivals.set(runId, count)
            if (count === 2) {
              events.emit('second-copy-arrived', runId)
            }
          }
          await next()
        }
      })
      .withHandler(
        handlerFor(TestOutboxCommand, async ({ runId, scenario }) => {
          handledCommands.push(runId)
          if (scenario === 'overlap') {
            // Holds this copy's transaction open until the second copy has been read, so they're handled at once
            overlapped.set(runId, await secondCopyArrived(runId))
          }
          if (scenario === 'fail-once' && !runIdsThatFailedOnce.has(runId)) {
            runIdsThatFailedOnce.add(runId)
            throw new Error('Handler failed once')
          }
          if (runIdsThatFail.has(runId)) {
            throw new Error('Handler failed')
          }
          events.emit('handled', runId)
        })
      )
      .build()
    secondBus = buildBus(secondQueue, SECOND_ENDPOINT).build()
    // Provisioned as a deploy would, so initialize() only checks the persistence's storage, inbox included, exists
    await firstBus.provision()
    await secondBus.provision()
    await firstBus.initialize()
    await secondBus.initialize()
    await firstBus.start()
    await secondBus.start()
  })

  afterAll(async () => {
    await firstBus.dispose()
    await secondBus.dispose()
  })

  describe('when a message is recorded and committed', () => {
    const messageId = randomUUID()
    let first: boolean
    let again: boolean
    let onAnotherEndpoint: boolean

    beforeAll(async () => {
      first = await recordCommitted(FIRST_ENDPOINT, messageId)
      again = await recordCommitted(FIRST_ENDPOINT, messageId)
      onAnotherEndpoint = await recordCommitted(SECOND_ENDPOINT, messageId)
    })

    it('should record it', () => {
      expect(first).toEqual(true)
    })

    it('should not record it again', () => {
      expect(again).toEqual(false)
    })

    it('should record it for another endpoint', () => {
      expect(onAnotherEndpoint).toEqual(true)
    })
  })

  describe('when a message is recorded twice in one transaction', () => {
    const messageId = randomUUID()
    let first: boolean
    let again: boolean

    beforeAll(async () => {
      const transaction = await beginTransaction()
      first = await transaction.recordIncomingMessage(FIRST_ENDPOINT, messageId)
      again = await transaction.recordIncomingMessage(FIRST_ENDPOINT, messageId)
      await transaction.rollback()
    })

    it('should record it the first time', () => {
      expect(first).toEqual(true)
    })

    it('should not record it the second time', () => {
      expect(again).toEqual(false)
    })
  })

  describe('when a message is recorded and rolled back', () => {
    const messageId = randomUUID()
    let afterRollback: boolean

    beforeAll(async () => {
      const transaction = await beginTransaction()
      await transaction.recordIncomingMessage(FIRST_ENDPOINT, messageId)
      await transaction.rollback()
      afterRollback = await recordCommitted(FIRST_ENDPOINT, messageId)
    })

    it('should record it again', () => {
      expect(afterRollback).toEqual(true)
    })
  })

  describe('when a message is recorded while another transaction that recorded it is open', () => {
    describe('and that transaction is committed', () => {
      const messageId = randomUUID()
      let blocked: boolean
      let recorded: boolean

      beforeAll(async () => {
        const holder = await beginTransaction()
        await holder.recordIncomingMessage(FIRST_ENDPOINT, messageId)
        const waiter = await beginTransaction()
        const recording = waiter.recordIncomingMessage(
          FIRST_ENDPOINT,
          messageId
        )
        blocked = await isBlocked(recording)
        await holder.commit()
        recorded = await recording
        await waiter.rollback()
      })

      it('should wait for that transaction to end', () => {
        expect(blocked).toEqual(true)
      })

      it('should not record it', () => {
        expect(recorded).toEqual(false)
      })
    })

    describe('and that transaction is rolled back', () => {
      const messageId = randomUUID()
      let blocked: boolean
      let recorded: boolean
      let afterCommit: boolean

      beforeAll(async () => {
        const holder = await beginTransaction()
        await holder.recordIncomingMessage(FIRST_ENDPOINT, messageId)
        const waiter = await beginTransaction()
        const recording = waiter.recordIncomingMessage(
          FIRST_ENDPOINT,
          messageId
        )
        blocked = await isBlocked(recording)
        await holder.rollback()
        recorded = await recording
        await waiter.commit()
        afterCommit = await recordCommitted(FIRST_ENDPOINT, messageId)
      })

      it('should wait for that transaction to end', () => {
        expect(blocked).toEqual(true)
      })

      it('should record it', () => {
        expect(recorded).toEqual(true)
      })

      it('should keep the record once it is committed', () => {
        expect(afterCommit).toEqual(false)
      })
    })
  })

  describe('when a command is delivered twice with the same messageId', () => {
    const runId = randomUUID()

    beforeAll(async () => {
      const messageId = randomUUID()
      const command = new TestOutboxCommand(runId, 'succeed')
      const handled = waitFor('handled', runId)
      await firstBus.send(command, { messageId })
      await handled
      await firstBus.send(command, { messageId })
      await firstQueue.idle()
    })

    it('should handle it once', () => {
      expect(timesHandled(runId)).toEqual(1)
    })

    it('should delete the copy', () => {
      expect(firstQueue.depth).toEqual(0)
      expect(firstQueue.deadLetterQueueDepth).toEqual(0)
    })
  })

  describe('when two copies of a command are delivered at the same time', () => {
    const runId = randomUUID()

    beforeAll(async () => {
      const messageId = randomUUID()
      const command = new TestOutboxCommand(runId, 'overlap')
      await Promise.all([
        firstBus.send(command, { messageId }),
        firstBus.send(command, { messageId })
      ])
      await firstQueue.idle()
    })

    it('should read the second copy while the first is being handled', () => {
      expect(overlapped.get(runId)).toEqual(true)
    })

    it('should handle it once', () => {
      expect(timesHandled(runId)).toEqual(1)
    })
  })

  describe('when an event with one messageId is delivered to two endpoints', () => {
    const runId = randomUUID()

    beforeAll(async () => {
      const messageId = randomUUID()
      const event = new TestOutboxEvent(runId, 'inbox')
      // Each in-memory queue is its own endpoint, so the event is published to each, as a broker fans it out
      await firstBus.publish(event, { messageId })
      await secondBus.publish(event, { messageId })
      await firstQueue.idle()
      await secondQueue.idle()
      // A copy delivered again to each
      await firstBus.publish(event, { messageId })
      await secondBus.publish(event, { messageId })
      await firstQueue.idle()
      await secondQueue.idle()
    })

    it('should handle it once on each endpoint', () => {
      expect(timesReceived(FIRST_ENDPOINT, runId)).toEqual(1)
      expect(timesReceived(SECOND_ENDPOINT, runId)).toEqual(1)
    })
  })

  describe('when a handler fails once', () => {
    const runId = randomUUID()

    beforeAll(async () => {
      const messageId = randomUUID()
      const command = new TestOutboxCommand(runId, 'fail-once')
      const handled = waitFor('handled', runId)
      await firstBus.send(command, { messageId })
      await handled
      await firstQueue.idle()
      await firstBus.send(command, { messageId })
      await firstQueue.idle()
    })

    it('should handle the retry, and not a copy delivered after it', () => {
      expect(timesHandled(runId)).toEqual(2)
    })
  })

  describe('when a message is dead-lettered and replayed', () => {
    const runId = randomUUID()
    const messageId = randomUUID()
    let replayedHeaders: TransportHeaders
    let replayedMessageId: string | undefined

    beforeAll(async () => {
      runIdsThatFail.add(runId)
      const deadLettered = waitFor('dead-lettered', runId)
      await firstBus.send(new TestOutboxCommand(runId, 'succeed'), {
        messageId
      })
      await deadLettered
      await firstQueue.idle()
      runIdsThatFail.delete(runId)
      const deadLetter = firstQueue.deadLetterQueue.find(
        ({ domainMessage }) =>
          (domainMessage as TestOutboxCommand).runId === runId
      )!
      replayedHeaders = deadLetter.raw.headers
      replayedMessageId = deadLetter.attributes.messageId
      const handled = waitFor('handled', runId)
      // Moved back to the queue as it was dead-lettered, with its attributes and bus-failure header, as an operator
      // replays it
      await firstQueue.send(deadLetter.domainMessage, deadLetter.attributes, {
        headers: deadLetter.raw.headers
      })
      await handled
      await firstQueue.idle()
    })

    it('should replay it with its messageId and failure header', () => {
      expect(replayedMessageId).toEqual(messageId)
      expect(replayedHeaders[FAILURE_HEADER]).toBeDefined()
    })

    it('should handle the replay', () => {
      expect(timesHandled(runId)).toEqual(MAX_ATTEMPTS + 1)
    })
  })

  // Last, since it removes every record in the persistence
  describe('when records are removed', () => {
    const messageId = randomUUID()
    let afterRemovingOlder: boolean
    let firstBatch: number
    let afterRemovingNewer: boolean

    beforeAll(async () => {
      await recordCommitted(FIRST_ENDPOINT, messageId)
      await recordCommitted(SECOND_ENDPOINT, messageId)
      await recordCommitted(FIRST_ENDPOINT, randomUUID())
      // Hours either side, so the clocks of the process and the database needn't agree
      while (
        (await removeIncomingMessagesBefore(
          new Date(Date.now() - HOUR_MS),
          100
        )) > 0
      ) {
        // Removes any records an earlier run left more than an hour ago
      }
      afterRemovingOlder = await recordCommitted(FIRST_ENDPOINT, messageId)
      const removeAllBefore = new Date(Date.now() + HOUR_MS)
      firstBatch = await removeIncomingMessagesBefore(removeAllBefore, 2)
      while ((await removeIncomingMessagesBefore(removeAllBefore, 2)) > 0) {
        // Removes the rest, two at a time
      }
      afterRemovingNewer = await recordCommitted(FIRST_ENDPOINT, messageId)
    })

    it('should keep records made after the time', () => {
      expect(afterRemovingOlder).toEqual(false)
    })

    it('should remove no more than the limit at once, and say how many it removed', () => {
      expect(firstBatch).toEqual(2)
    })

    it('should remove records made before the time', () => {
      expect(afterRemovingNewer).toEqual(true)
    })
  })
}
