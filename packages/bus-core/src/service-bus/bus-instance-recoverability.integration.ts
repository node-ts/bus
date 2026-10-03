import { Message } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { HandlerDispatchRejected, handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  deadLetter,
  FAILURE_HEADER,
  MessageFailure,
  MessageHandlingFailure,
  RecoverabilityPolicy,
  retry
} from '../recoverability'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  TestCommand,
  TestEvent,
  testMessageTypes
} from '../test'
import { TransportHeaderReserved } from '../transport'
import { defineWorkflow, InMemoryPersistence, WorkflowState } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

/**
 * A queue that gives up waiting for a read quickly, so `bus.stop()` returns soon after the last message
 */
const recordingQueue = (
  onDispatched: (message: Message) => void = () => undefined
) => new RecordingInMemoryQueue(onDispatched, { receiveTimeoutMs: 50 })

/**
 * Collects what a queue settles. `settled(bus)` resolves once a message is deleted or dead-lettered and the bus has
 * finished settling it, by stopping the bus, which waits for the worker to finish the message it's handling. That
 * way a second settlement of the same message, such as a return after a dead-letter, is caught too.
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
    settled: async (bus: BusInstance) => {
      await finished
      await bus.stop()
    }
  }
}

describe('BusInstance recoverability', () => {
  describe('when a custom policy is configured', () => {
    let bus: BusInstance
    const queue = recordingQueue()
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
      await settlements.settled(bus)
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
    const queue = recordingQueue()
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
      await settlements.settled(bus)
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
    const queue = recordingQueue()
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
      await settlements.settled(bus)
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
    const queue = recordingQueue()
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
      await settlements.settled(bus)
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
    const queue = recordingQueue()
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
      await settlements.settled(bus)
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

  describe('when a handler sends a message and then fails the message', () => {
    let bus: BusInstance
    const dispatched: Message[] = []
    const queue = recordingQueue(message => dispatched.push(message))
    const settlements = recordSettlements(queue)

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.publish(new TestEvent('before-fail'))
            await ctx.failMessage()
            await ctx.publish(new TestEvent('after-fail'))
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.settled(bus)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should dead-letter the message', () => {
      expect(settlements.failures).toHaveLength(1)
    })

    it('should drop the messages the handler sent', () => {
      expect(dispatched.map(message => message.$name)).toEqual([
        TestCommand.NAME
      ])
    })
  })

  describe('when a handler sends a message and then returns the message', () => {
    let bus: BusInstance
    const dispatched: TestEvent[] = []
    const queue = recordingQueue(message => {
      if (message instanceof TestEvent) {
        dispatched.push(message)
      }
    })
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
            const attempt = ++handled
            await ctx.publish(new TestEvent(`attempt-${attempt}`))
            if (attempt === 1) {
              await ctx.returnMessage()
            }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.settled(bus)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop the messages sent on the attempt that returned it', () => {
      expect(dispatched.map(event => event.property1)).toEqual(['attempt-2'])
    })
  })

  describe('when a workflow handler changes the state and then fails the message', () => {
    class FailedWorkflowState extends WorkflowState {
      static NAME = '@node-ts/bus-core/failed-workflow-state'
      $name = FailedWorkflowState.NAME
      progress: string
    }

    const workflow = defineWorkflow(FailedWorkflowState).startedBy(
      TestCommand,
      async (_message, _state, ctx) => {
        await ctx.failMessage()
        return { progress: 'started' }
      }
    )

    let bus: BusInstance
    const queue = recordingQueue()
    const settlements = recordSettlements(queue)
    const persistence = new InMemoryPersistence()
    let saves = 0

    beforeAll(async () => {
      const saveWorkflowState = persistence.saveWorkflowState.bind(persistence)
      persistence.saveWorkflowState = async state => {
        saves++
        await saveWorkflowState(state)
      }
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(FailedWorkflowState)
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withWorkflow(workflow)
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.settled(bus)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should dead-letter the message', () => {
      expect(settlements.failures).toHaveLength(1)
    })

    it('should not save the workflow state', () => {
      expect(saves).toEqual(0)
    })
  })

  describe.each([
    ['undefined', () => undefined],
    ['a promise', async () => retry(0)],
    ['a NaN delay', () => ({ action: 'retry', delay: NaN })]
  ])('when the policy returns %s', (_, policy) => {
    let bus: BusInstance
    const queue = recordingQueue()
    const settlements = recordSettlements(queue)
    const logger = Mock.ofType<Logger>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(queue)
        .withRecoverability(policy as unknown as RecoverabilityPolicy)
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new Error('Handler failed')
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await settlements.settled(bus)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should dead-letter the message without retrying it', () => {
      expect(settlements.returnedDelays).toHaveLength(0)
      expect(settlements.failures).toHaveLength(1)
    })

    it('should log that the policy returned an invalid action', () => {
      logger.verify(
        l =>
          l.error(
            'Recoverability policy returned neither retry(delay) nor deadLetter(), so the message will be moved to the dead letter queue',
            It.isAny()
          ),
        Times.once()
      )
    })
  })
})

describe('BusInstance outgoing headers', () => {
  describe('when outgoing middleware sets a bus-failure header', () => {
    let bus: BusInstance
    let sendError: unknown

    beforeAll(async () => {
      // This queue doesn't reserve bus-failure itself, so the bus has to
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(recordingQueue())
        .withMiddleware({
          outgoing: async (context, next) => {
            context.headers[FAILURE_HEADER] = '{}'
            await next()
          }
        })
        .asSendOnly()
        .build()
      await bus.initialize()
      sendError = await bus.send(new TestCommand()).catch(error => error)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject the send with TransportHeaderReserved', () => {
      expect(sendError).toBeInstanceOf(TransportHeaderReserved)
      expect(sendError).toMatchObject({ headerName: FAILURE_HEADER })
    })
  })
})
