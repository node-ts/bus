import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { HandlerDispatchRejected, handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  deadLetter,
  MessageFailure,
  MessageHandlingFailure,
  RecoverabilityPolicy,
  retry
} from '../recoverability'
import { RecordingInMemoryQueue, TestCommand, testMessageTypes } from '../test'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

/**
 * Collects what a queue settles, and resolves once a message is deleted or dead-lettered
 */
const recordSettlements = (queue: RecordingInMemoryQueue) => {
  const returnedDelays: number[] = []
  const failures: MessageFailure[] = []
  let deletes = 0
  queue.settled.on('returned', (_, delay: number) => returnedDelays.push(delay))
  queue.settled.on('failed', (_, failure: MessageFailure) =>
    failures.push(failure)
  )
  queue.settled.on('deleted', () => deletes++)
  const finished = Promise.race([
    once(queue.settled, 'deleted'),
    once(queue.settled, 'failed')
  ])
  return {
    returnedDelays,
    failures,
    deletes: () => deletes,
    finished
  }
}

describe('BusInstance recoverability', () => {
  describe('when a custom policy is configured', () => {
    let bus: BusInstance
    const queue = new RecordingInMemoryQueue(() => undefined)
    const settlements = recordSettlements(queue)
    const policyCalls: MessageHandlingFailure[] = []
    const messageId = randomUUID()
    const policy: RecoverabilityPolicy = failure => {
      policyCalls.push(failure)
      return failure.failedAttempts < 3 ? retry(10) : deadLetter()
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withRecoverability(policy)
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new TypeError('Handler failed')
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand(), { messageId })
      await settlements.finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should call the policy with the failed attempts counting up from 1', () => {
      expect(policyCalls.map(call => call.failedAttempts)).toEqual([1, 2, 3])
    })

    it('should call the policy with the message, its attributes and the error', () => {
      const [firstCall] = policyCalls
      expect(firstCall.message).toBeInstanceOf(TestCommand)
      expect(firstCall.attributes.messageId).toEqual(messageId)
      expect(firstCall.error).toBeInstanceOf(HandlerDispatchRejected)
    })

    it('should return the message with the delay the policy chose', () => {
      expect(settlements.returnedDelays).toEqual([10, 10])
    })

    it('should dead-letter it when the policy says so', () => {
      expect(settlements.failures).toHaveLength(1)
      expect(queue.deadLetterQueueDepth).toEqual(1)
    })

    it('should describe the handler error in the failure metadata', () => {
      const [failure] = settlements.failures
      expect(failure).toMatchObject({
        error: { name: 'TypeError', message: 'Handler failed' },
        failedAttempts: 3,
        endpoint: 'in-memory',
        messageId
      })
      expect(failure.error.stack).toContain('Handler failed')
    })

    it('should not delete the message', () => {
      expect(settlements.deletes()).toEqual(0)
    })
  })

  describe('when a handler fails the message and then throws', () => {
    let bus: BusInstance
    const queue = new RecordingInMemoryQueue(() => undefined)
    const settlements = recordSettlements(queue)
    const policy = Mock.ofType<RecoverabilityPolicy>()
    let handled = 0

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withRecoverability(policy.object)
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            handled++
            await ctx.failMessage()
            throw new Error('Thrown after failMessage')
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should handle the message once', () => {
      expect(handled).toEqual(1)
    })

    it('should dead-letter it once, without retrying it', () => {
      expect(settlements.failures).toHaveLength(1)
      expect(settlements.returnedDelays).toHaveLength(0)
    })

    it('should not consult the policy', () => {
      policy.verify(p => p(It.isAny()), Times.never())
    })

    it('should record the thrown error in the failure metadata', () => {
      expect(settlements.failures[0].error.message).toEqual(
        'Thrown after failMessage'
      )
    })
  })

  describe('when a handler returns the message and then throws', () => {
    let bus: BusInstance
    const queue = new RecordingInMemoryQueue(() => undefined)
    const settlements = recordSettlements(queue)
    let handled = 0

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withRecoverability(() => retry(0))
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            if (++handled === 1) {
              await ctx.returnMessage()
              throw new Error('Thrown after returnMessage')
            }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should return the message once', () => {
      expect(settlements.returnedDelays).toEqual([0])
    })

    it('should handle it again and then delete it', () => {
      expect(handled).toEqual(2)
      expect(settlements.deletes()).toEqual(1)
    })
  })

  describe('when a handler returns the message and the policy dead-letters it', () => {
    let bus: BusInstance
    const queue = new RecordingInMemoryQueue(() => undefined)
    const settlements = recordSettlements(queue)
    let policyError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withRecoverability(({ error }) => {
          policyError = error
          return deadLetter()
        })
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.returnMessage()
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should pass the policy a ReturnMessageRequested error', () => {
      expect((policyError as Error).constructor.name).toEqual(
        'ReturnMessageRequested'
      )
    })

    it('should dead-letter the message with that error', () => {
      expect(settlements.failures[0].error.name).toEqual(
        'ReturnMessageRequested'
      )
    })
  })

  describe('when the policy throws', () => {
    let bus: BusInstance
    const queue = new RecordingInMemoryQueue(() => undefined)
    const settlements = recordSettlements(queue)
    const logger = Mock.ofType<Logger>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(queue)
        .withRecoverability(() => {
          throw new Error('Policy failed')
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new Error('Handler failed')
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should dead-letter the message with the handling error', () => {
      expect(settlements.returnedDelays).toHaveLength(0)
      expect(settlements.failures[0].error.message).toEqual('Handler failed')
    })

    it('should log the policy error', () => {
      logger.verify(
        l =>
          l.error(
            'Recoverability policy threw, so the message will be moved to the dead letter queue',
            It.isAny()
          ),
        Times.once()
      )
    })
  })
})
