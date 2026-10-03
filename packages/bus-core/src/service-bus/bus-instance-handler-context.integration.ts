import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'events'
import { It, Mock, Times } from 'typemoq'
import { BusSender, HandlerContext, handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  TestCommand,
  TestCommand2,
  TestCommandContextClassHandler,
  testCommandContextHandler,
  TestEvent,
  testMessageTypes
} from '../test'
import { InMemoryQueue } from '../transport'
import { ClassConstructor } from '../util'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'
import { FinalTask, RunTask } from '../workflow/test'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

/**
 * Sends through any `BusSender`, which `BusInstance` implements
 */
const sendTestCommand = async (
  sender: BusSender,
  messageAttributes?: Partial<MessageAttributes>
) => sender.send(new TestCommand(), messageAttributes)

describe('BusInstance handler context', () => {
  describe('when a function handler publishes through its context', () => {
    let bus: BusInstance
    let receivedEvent: TestEvent
    let receivedAttributes: MessageAttributes

    beforeAll(async () => {
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(testCommandContextHandler)
        .withHandler(
          handlerFor(TestEvent, async (event, attributes) => {
            events.emit('received', event, attributes)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await sendTestCommand(bus, { correlationId: 'correlation-id' })
      ;[receivedEvent, receivedAttributes] = await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should give the handler the correlation id of the message', () => {
      expect(receivedEvent.property1).toEqual('correlation-id')
    })

    it('should publish the event with the same correlation id', () => {
      expect(receivedAttributes.correlationId).toEqual('correlation-id')
    })
  })

  describe('when a handler publishes a message with its own messageId and sentAt', () => {
    const messageId = 'command-message-id'
    const sentAt = '2026-01-01T00:00:00.000Z'
    let bus: BusInstance
    let commandAttributes: MessageAttributes
    let eventAttributes: MessageAttributes

    beforeAll(async () => {
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(
          handlerFor(TestCommand, async (_, attributes, ctx) => {
            commandAttributes = attributes
            await ctx.publish(new TestEvent())
          })
        )
        .withHandler(
          handlerFor(TestEvent, async (_, attributes) => {
            events.emit('received', attributes)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await sendTestCommand(bus, {
        correlationId: 'correlation-id',
        messageId,
        sentAt
      })
      ;[eventAttributes] = await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should give the handler the messageId and sentAt the message was sent with', () => {
      expect(commandAttributes).toMatchObject({ messageId, sentAt })
    })

    it('should give the published message a new messageId', () => {
      expect(eventAttributes.messageId).toEqual(expect.any(String))
      expect(eventAttributes.messageId).not.toEqual(messageId)
    })

    it('should give the published message its own sentAt', () => {
      expect(eventAttributes.sentAt).toEqual(expect.any(String))
      expect(eventAttributes.sentAt).not.toEqual(sentAt)
    })

    it('should still inherit the correlation id', () => {
      expect(eventAttributes.correlationId).toEqual('correlation-id')
    })
  })

  describe('when a function handler publishes through its context and then fails', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      const failures = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message), {
            maxRetries: 0,
            receiveTimeoutMs: 100
          })
        )
        .withMiddleware({
          incoming: async (_, next) => {
            try {
              await next()
            } catch (error) {
              failures.emit('failed')
              throw error
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.publish(new TestEvent('failing-handler'))
            throw new Error('Failing handler')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(failures, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop the event', () => {
      dispatched.verify(
        c => c(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })
  })

  describe('when a class handler publishes through its context', () => {
    let bus: BusInstance
    let receivedEvent: TestEvent

    beforeAll(async () => {
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withContainer({
          get: <T>(type: ClassConstructor<T>) => new type()
        })
        .withHandler(TestCommandContextClassHandler)
        .withHandler(
          handlerFor(TestEvent, async event => {
            events.emit('received', event)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await bus.send(new TestCommand2())
      ;[receivedEvent] = await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should publish the event', () => {
      expect(receivedEvent.property1).toEqual('from-class-handler')
    })
  })

  describe('when a handler fails the message through its context', () => {
    let bus: BusInstance
    const queue = new InMemoryQueue({ maxRetries: 0, receiveTimeoutMs: 100 })

    beforeAll(async () => {
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(queue)
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.failMessage()
            events.emit('failed')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(events, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should send the message to the dead letter queue', () => {
      expect(queue.deadLetterQueueDepth).toEqual(1)
    })
  })

  describe('when a class workflow publishes through its context', () => {
    let bus: BusInstance
    const events = new EventEmitter()
    let startedWorkflowId: string
    let finishedWorkflowId: string
    let finishedCorrelationId: string | undefined

    class ContextWorkflowState extends WorkflowState {
      static NAME = '@node-ts/bus-core/context-workflow-state'
      $name = ContextWorkflowState.NAME
    }

    class ContextWorkflow extends Workflow<ContextWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<ContextWorkflowState, ContextWorkflow>
      ): void {
        mapper
          .withState(ContextWorkflowState)
          .startedBy(RunTask, 'start')
          // Matches on the workflow id that the context put in the sticky attributes
          .when(FinalTask, 'finish')
      }

      async start(
        _message: RunTask,
        state: ContextWorkflowState,
        _attributes: MessageAttributes,
        ctx: HandlerContext
      ) {
        startedWorkflowId = state.$workflowId
        await ctx.publish(new FinalTask())
        return {}
      }

      finish(
        _message: FinalTask,
        state: ContextWorkflowState,
        _attributes: MessageAttributes,
        ctx: HandlerContext
      ) {
        finishedWorkflowId = state.$workflowId
        finishedCorrelationId = ctx.correlationId
        events.emit('finished')
        return this.completeWorkflow()
      }
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(ContextWorkflowState)
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withWorkflow(ContextWorkflow)
        .build()

      await bus.initialize()
      await bus.start()
      const finished = once(events, 'finished')
      await bus.send(new RunTask('task'), { correlationId: 'workflow-run' })
      await finished
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should route the event back to the same workflow instance', () => {
      expect(finishedWorkflowId).toEqual(startedWorkflowId)
    })

    it('should carry the correlation id through the workflow', () => {
      expect(finishedCorrelationId).toEqual('workflow-run')
    })
  })
})
