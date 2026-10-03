import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'events'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { Receiver } from '../receiver'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  testMessageTypes
} from '../test'
import { TestCommand } from '../test/test-command'
import { TestEvent } from '../test/test-event'
import { InMemoryQueue, TransportMessage } from '../transport'
import { sleep } from '../util'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(20_000)

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
        .withTransport(
          new InMemoryQueue({ maxRetries: 0, receiveTimeoutMs: 100 })
        )
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
            maxRetries: 0,
            receiveTimeoutMs: 100
          })
        )
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
          raw: { acknowledge: () => undefined }
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
    const inMemoryTransport = new InMemoryQueue({
      maxRetries: 0,
      receiveTimeoutMs: 100
    })

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(inMemoryTransport)
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

    it('should send the non-failing handler message to the transport', async () => {
      testEventCallback.verify(t => t('success-handler'), Times.once())
    })

    it('should not send the message from the failing handler to the transport', async () => {
      testEventCallback.verify(t => t('failing-handler'), Times.never())
    })
  })
  describe('when a message is sent in a workflow handler, that fails to persist', () => {
    let bus: BusInstance
    const testCommandCallback = Mock.ofType<() => void>()
    const testEventCallback = Mock.ofType<(source: string) => void>()
    const inMemoryTransport = new InMemoryQueue({
      maxRetries: 0,
      receiveTimeoutMs: 100
    })

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
})
