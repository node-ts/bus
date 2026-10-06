import { Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'events'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { Receiver } from '../receiver'
import { deadLetter, retry } from '../recoverability'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  testMessageTypes
} from '../test'
import { TestCommand } from '../test/test-command'
import { TestCommand2 } from '../test/test-command-2'
import { TestEvent } from '../test/test-event'
import { InMemoryQueue, TransportMessage } from '../transport'
import { sleep } from '../util'
import {
  defineWorkflow,
  InMemoryPersistence,
  Workflow,
  WorkflowMapper,
  WorkflowState,
  WorkflowStateVersionConflict
} from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(20_000)

class RequestedWorkflowState extends WorkflowState {
  static NAME = 'RequestedWorkflowState'
  $name = RequestedWorkflowState.NAME
  requested: boolean
}

class StartOrder extends Command {
  static NAME = 'StartOrder'
  $name = StartOrder.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

class ProcessOrder extends Command {
  static NAME = 'ProcessOrder'
  $name = ProcessOrder.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

class RequestedOrderWorkflowState extends WorkflowState {
  static NAME = 'RequestedOrderWorkflowState'
  $name = RequestedOrderWorkflowState.NAME
  orderId: string
  requested: boolean
}

class ProcessedWorkflowState extends WorkflowState {
  static NAME = 'ProcessedWorkflowState'
  $name = ProcessedWorkflowState.NAME
  orderId: string
  processed: boolean
}

/**
 * An in-memory persistence whose nth update of one workflow state fails, once, as if it had been saved elsewhere since
 * it was read
 */
class ConflictOnceOnUpdatePersistence extends InMemoryPersistence {
  private updates = 0

  /**
   * @param workflowStateName the `$name` of the workflow state whose update fails
   * @param conflictingUpdate which of its updates fails, counting from 1
   */
  constructor(
    private readonly workflowStateName: string,
    private readonly conflictingUpdate = 1
  ) {
    super()
  }

  async saveWorkflowState<TWorkflowState extends WorkflowState>(
    workflowState: TWorkflowState
  ): Promise<void> {
    if (
      workflowState.$name === this.workflowStateName &&
      workflowState.$version > 0 &&
      ++this.updates === this.conflictingUpdate
    ) {
      throw new WorkflowStateVersionConflict(
        workflowState.$name,
        workflowState.$workflowId,
        workflowState.$version,
        workflowState.$version + 1
      )
    }
    await super.saveWorkflowState(workflowState)
  }
}

/**
 * An in-memory persistence whose first save fails, as if the state had been saved elsewhere since it was read
 */
class ConflictOncePersistence extends InMemoryPersistence {
  private hasConflicted = false

  async saveWorkflowState<TWorkflowState extends WorkflowState>(
    workflowState: TWorkflowState
  ): Promise<void> {
    if (!this.hasConflicted) {
      this.hasConflicted = true
      throw new WorkflowStateVersionConflict(
        workflowState.$name,
        workflowState.$workflowId,
        workflowState.$version,
        workflowState.$version + 1
      )
    }
    await super.saveWorkflowState(workflowState)
  }
}

describe('BusInstance Outboxing', () => {
  describe('when a message is sent from outside of a handler', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message))
        )
        .build()

      await bus.initialize()
      await bus.send(new TestCommand())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should send the message to the transport', () => {
      dispatched.verify(
        c => c(It.isObjectWith<Message>({ $name: TestCommand.NAME })),
        Times.once()
      )
    })
  })

  describe('when a message is sent from incoming middleware', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()
    const events = new EventEmitter()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message))
        )
        .withMiddleware({
          incoming: async (context, next) => {
            if (context.message.$name === TestCommand.NAME) {
              await context.publish(new TestEvent('from-middleware'))
            }
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            events.emit('received', event)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await bus.send(new TestCommand())
      await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should publish the message straight to the transport', () => {
      dispatched.verify(
        c => c(It.isObjectWith<TestEvent>({ property1: 'from-middleware' })),
        Times.once()
      )
    })
  })

  describe('when a message is sent from incoming middleware after a handler fails', () => {
    let bus: BusInstance
    let receivedEvent: TestEvent

    beforeAll(async () => {
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(new InMemoryQueue({ receiveTimeoutMs: 100 }))
        .withRecoverability(() => deadLetter())
        .withMiddleware({
          incoming: async (context, next) => {
            try {
              await next()
            } catch (error) {
              await context.publish(new TestEvent('from-incoming-middleware'))
              throw error
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new Error('Failing Handler')
          })
        )
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            events.emit('received', event)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await bus.send(new TestCommand())
      ;[receivedEvent] = await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should publish the message', () => {
      expect(receivedEvent.property1).toEqual('from-incoming-middleware')
    })
  })

  describe('when a message is sent after its handler resolved', () => {
    let bus: BusInstance
    const logger = Mock.ofType<Logger>()
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      let lateSendCompleted: () => void
      const lateSend = new Promise<void>(resolve => {
        lateSendCompleted = resolve
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message))
        )
        .withHandler(
          handlerFor(TestCommand, async () => {
            // Deliberately not awaited, so the send happens after the handler resolves
            setTimeout(() => {
              void bus.publish(new TestEvent('late')).then(lateSendCompleted)
            }, 50)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await lateSend
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should publish the message straight away', () => {
      dispatched.verify(
        c => c(It.isObjectWith<TestEvent>({ property1: 'late' })),
        Times.once()
      )
    })

    it('should log a warning', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(m => m.includes('after its handler resolved')),
            It.isAny()
          ),
        Times.once()
      )
    })
  })

  describe('when a message is sent after its handler failed', () => {
    let bus: BusInstance
    const logger = Mock.ofType<Logger>()
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      let lateSendCompleted: () => void
      const lateSend = new Promise<void>(resolve => {
        lateSendCompleted = resolve
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message), {
            receiveTimeoutMs: 100
          })
        )
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async () => {
            // Deliberately not awaited, so the send happens after the handler fails
            setTimeout(() => {
              void bus.publish(new TestEvent('late')).then(lateSendCompleted)
            }, 50)
            throw new Error('Failing Handler')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await lateSend
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop the message', () => {
      dispatched.verify(
        c => c(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })

    it('should log a warning', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(m => m.includes('after its handler failed')),
            It.isAny()
          ),
        Times.once()
      )
    })
  })

  describe('when a workflow handles a message whose raw transport message cannot be cloned', () => {
    let bus: BusInstance
    let receiveError: unknown
    let workflowStickyAttributes: MessageAttributes['stickyAttributes']

    class UncloneableRawReceiver implements Receiver<
      Message,
      TransportMessage<unknown>
    > {
      async receive(
        domainMessage: Message
      ): Promise<TransportMessage<unknown>> {
        return {
          id: crypto.randomUUID(),
          attributes: { attributes: {}, stickyAttributes: {} },
          domainMessage,
          // Functions can't be structured cloned
          raw: { acknowledge: () => undefined },
          failedAttempts: 0
        }
      }
    }

    class UncloneableRawWorkflowState extends WorkflowState {
      static NAME = 'UncloneableRawWorkflowState'
      $name = UncloneableRawWorkflowState.NAME
    }

    class UncloneableRawWorkflow extends Workflow<UncloneableRawWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<
          UncloneableRawWorkflowState,
          UncloneableRawWorkflow
        >
      ): void {
        mapper
          .withState(UncloneableRawWorkflowState)
          .startedBy(TestCommand, 'step1')
      }

      async step1(): Promise<Partial<UncloneableRawWorkflowState>> {
        workflowStickyAttributes =
          bus.getHandlingContext()!.attributes.stickyAttributes
        return {}
      }
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor('UncloneableRawWorkflowState')
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withReceiver(new UncloneableRawReceiver())
        .withWorkflow(UncloneableRawWorkflow)
        .build()

      await bus.initialize()
      try {
        await bus.receive(new TestCommand())
      } catch (error) {
        receiveError = error
      }
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should handle the message', () => {
      expect(receiveError).toBeUndefined()
    })

    it('should add the workflow id to the sticky attributes', () => {
      expect(workflowStickyAttributes.workflowId).toEqual(expect.any(String))
    })
  })

  describe('when a large number of messages are sent from inside a handler', () => {
    let bus: BusInstance

    beforeAll(async () => {
      const numberOfMessages = 20_000

      let messagesPublishedCount = 0
      let allMessagesPublished: () => void
      const messagesPublished = new Promise<void>(resolve => {
        allMessagesPublished = resolve
      })

      // TestEvent has no handler, so the queue logs a discard for every publish
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(
          new RecordingInMemoryQueue(message => {
            if (
              message.$name === TestEvent.NAME &&
              ++messagesPublishedCount === numberOfMessages
            ) {
              allMessagesPublished()
            }
          })
        )
        .withHandler(
          handlerFor(TestCommand, async () => {
            const publishMessages = new Array(numberOfMessages)
              .fill(undefined)
              .map(async () => bus.publish(new TestEvent()))
            await Promise.all(publishMessages)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand())
      await messagesPublished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should dispatch all messages without exhausting the heap', () => {
      // If code execution reaches this point, the test has passed and not run out of memory
    })
  })
  describe('when a message is sent from two handlers, and one fails', () => {
    let bus: BusInstance
    const testEventCallback = Mock.ofType<(source: string) => void>()
    const inMemoryTransport = new InMemoryQueue({ receiveTimeoutMs: 100 })

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(inMemoryTransport)
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async () => {
            await bus.send(new TestEvent('failing-handler'))
            throw new Error('Failing Handler')
          })
        )
        .withHandler(
          handlerFor(TestCommand, async () => {
            await bus.send(new TestEvent('success-handler'))
          })
        )
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            testEventCallback.object(event.property1!)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      await bus.send(new TestCommand())
      await sleep(1_000)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should not send the message from the other handler either, since the message will be retried', async () => {
      testEventCallback.verify(t => t('success-handler'), Times.never())
    })

    it('should not send the message from the failing handler to the transport', async () => {
      testEventCallback.verify(t => t('failing-handler'), Times.never())
    })
  })
  describe('when a message is sent in a workflow handler, that fails to persist', () => {
    let bus: BusInstance
    const testCommandCallback = Mock.ofType<() => void>()
    const testEventCallback = Mock.ofType<(source: string) => void>()
    const inMemoryTransport = new InMemoryQueue({ receiveTimeoutMs: 100 })

    class TestWorkflowState extends WorkflowState {
      static NAME = 'TestWorkflowState'
      $name = TestWorkflowState.NAME
    }

    class TestWorkflow extends Workflow<TestWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>
      ): void {
        mapper.withState(TestWorkflowState).startedBy(TestCommand, 'step1')
      }

      async step1(): Promise<Partial<TestWorkflowState>> {
        testCommandCallback.object()
        await bus.send(new TestEvent('failed-workflow'))
        throw new Error('Error in workflow')
      }
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor('TestWorkflowState')
        )
        .withTransport(inMemoryTransport)
        .withRecoverability(() => deadLetter())
        .withWorkflow(TestWorkflow)
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            testEventCallback.object(event.property1!)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      await bus.send(new TestCommand())
      await sleep(1_000)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should not send the message to the transport', async () => {
      testCommandCallback.verify(t => t(), Times.once())
      testEventCallback.verify(t => t('failed-workflow'), Times.never())
    })
  })

  describe('when a workflow handler guards on its state, and another handler of the message fails once', () => {
    let bus: BusInstance
    const persistence = new InMemoryPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    const requestedWhenHandled: boolean[] = []

    beforeAll(async () => {
      let failed = false
      let deletes = 0
      const handled = new EventEmitter()
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      queue.settled.on('deleted', () => {
        // The TestCommand that starts the workflow, then the TestCommand2 it sends
        if (++deletes === 2) {
          handled.emit('handled')
        }
      })
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(RequestedWorkflowState)
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(({ failedAttempts }) =>
          failedAttempts < 3 ? retry(0) : deadLetter()
        )
        .withWorkflow(
          defineWorkflow(RequestedWorkflowState)
            .startedBy(TestCommand, async (_message, _state, ctx) => {
              await ctx.send(new TestCommand2())
              return { requested: false }
            })
            .when(TestCommand2, async (_message, state, ctx) => {
              requestedWhenHandled.push(state.requested)
              if (state.requested) {
                return undefined
              }
              await ctx.publish(new TestEvent('requested'))
              return { requested: true }
            })
        )
        .withHandler(
          handlerFor(TestCommand2, async () => {
            if (!failed) {
              failed = true
              throw new Error('Fail the first attempt')
            }
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const allHandled = once(handled, 'handled')
      await bus.send(new TestCommand())
      await allHandled
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should publish what the workflow handler published once, when the message is retried', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'requested' })),
        Times.once()
      )
    })

    it('should not save the state the failed attempt returned', () => {
      expect(requestedWhenHandled).toEqual([false, false])
    })
  })

  describe('when the workflow state saved by a handler was saved elsewhere since it was read', () => {
    let bus: BusInstance
    const persistence = new ConflictOncePersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    const returned = Mock.ofType<() => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      queue.settled.on('returned', () => returned.object())
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(RequestedWorkflowState)
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(({ failedAttempts }) =>
          failedAttempts < 3 ? retry(0) : deadLetter()
        )
        .withWorkflow(
          defineWorkflow(RequestedWorkflowState).startedBy(
            TestCommand,
            async (_message, _state, ctx) => {
              await ctx.publish(new TestEvent('started'))
              return { requested: true }
            }
          )
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

    it('should fail the message and retry it', () => {
      returned.verify(r => r(), Times.once())
    })

    it('should only send what the attempt whose state was saved sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'started' })),
        Times.once()
      )
    })

    it('should save the state once', () => {
      expect(persistence.length(RequestedWorkflowState)).toEqual(1)
    })
  })

  describe("when two workflows handle a message, and the second one's state was saved elsewhere since it was read", () => {
    let bus: BusInstance
    const persistence = new ConflictOnceOnUpdatePersistence(
      ProcessedWorkflowState.NAME
    )
    const dispatched = Mock.ofType<(message: Message) => void>()
    const returned = Mock.ofType<() => void>()
    const requestedWhenHandled: boolean[] = []

    beforeAll(async () => {
      const handled = new EventEmitter()
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      queue.settled.on('returned', () => returned.object())
      queue.settled.on('deleted', (message: TransportMessage<unknown>) =>
        handled.emit((message.domainMessage as Message).$name)
      )
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(
            StartOrder,
            ProcessOrder,
            RequestedOrderWorkflowState,
            ProcessedWorkflowState
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(({ failedAttempts }) =>
          failedAttempts < 3 ? retry(0) : deadLetter()
        )
        .withWorkflow(
          defineWorkflow(RequestedOrderWorkflowState)
            .startedBy(StartOrder, ({ orderId }) => ({
              orderId,
              requested: false
            }))
            .when(
              ProcessOrder,
              { lookup: ({ orderId }) => orderId, mapsTo: 'orderId' },
              async (_message, state, ctx) => {
                requestedWhenHandled.push(state.requested)
                if (state.requested) {
                  return undefined
                }
                await ctx.publish(new TestEvent('requested'))
                return { requested: true }
              }
            ),
          defineWorkflow(ProcessedWorkflowState)
            .startedBy(StartOrder, ({ orderId }) => ({
              orderId,
              processed: false
            }))
            .when(
              ProcessOrder,
              { lookup: ({ orderId }) => orderId, mapsTo: 'orderId' },
              async () => {
                // Resolves after the other workflow, so its state is saved first
                await sleep(20)
                return { processed: true }
              }
            )
        )
        .build()

      await bus.initialize()
      await bus.start()
      const orderId = 'order-1'
      const started = once(handled, StartOrder.NAME)
      await bus.send(new StartOrder(orderId))
      await started
      const processed = once(handled, ProcessOrder.NAME)
      await bus.send(new ProcessOrder(orderId))
      await processed
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should retry the message', () => {
      returned.verify(r => r(), Times.once())
    })

    it('should skip the publish on the retry, since the first workflow saved its state', () => {
      expect(requestedWhenHandled).toEqual([false, true])
    })

    it('should still publish what the workflow whose state was saved published', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'requested' })),
        Times.once()
      )
    })
  })

  describe("when a workflow handler handles two instances of a workflow, and the second one's state was saved elsewhere since it was read", () => {
    let bus: BusInstance
    const persistence = new ConflictOnceOnUpdatePersistence(
      RequestedOrderWorkflowState.NAME,
      2
    )
    const returned = Mock.ofType<() => void>()
    const publishedFor: string[] = []

    beforeAll(async () => {
      const handled = new EventEmitter()
      const queue = new RecordingInMemoryQueue(
        message => {
          if (message.$name === TestEvent.NAME) {
            publishedFor.push((message as TestEvent).property1!)
          }
        },
        { receiveTimeoutMs: 100 }
      )
      queue.settled.on('returned', () => returned.object())
      queue.settled.on('deleted', (message: TransportMessage<unknown>) =>
        handled.emit((message.domainMessage as Message).$name)
      )
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(StartOrder, ProcessOrder, RequestedOrderWorkflowState)
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(({ failedAttempts }) =>
          failedAttempts < 3 ? retry(0) : deadLetter()
        )
        .withWorkflow(
          defineWorkflow(RequestedOrderWorkflowState)
            .startedBy(StartOrder, ({ orderId }) => ({
              orderId,
              requested: false
            }))
            // Matches both instances, which were started for the same order
            .when(
              ProcessOrder,
              { lookup: ({ orderId }) => orderId, mapsTo: 'orderId' },
              async (_message, state, ctx) => {
                if (state.requested) {
                  return undefined
                }
                await ctx.publish(new TestEvent(state.$workflowId))
                return { requested: true }
              }
            )
        )
        .build()

      await bus.initialize()
      await bus.start()
      const orderId = 'order-2'
      for (let started = 0; started < 2; started++) {
        const startHandled = once(handled, StartOrder.NAME)
        await bus.send(new StartOrder(orderId))
        await startHandled
      }
      const processed = once(handled, ProcessOrder.NAME)
      await bus.send(new ProcessOrder(orderId))
      await processed
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should retry the message', () => {
      returned.verify(r => r(), Times.once())
    })

    it('should publish what each instance published once in all', () => {
      expect(publishedFor).toHaveLength(2)
      expect(new Set(publishedFor).size).toEqual(2)
    })
  })
})
