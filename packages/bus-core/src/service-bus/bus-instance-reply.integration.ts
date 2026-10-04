import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import {
  DelayedReplyNotSupported,
  ReplyOutsideHandlingContext,
  ReturnAddressMissing
} from '../error'
import { HandlerContext, handlerFor } from '../handler'
import { Logger } from '../logger'
import { BusMiddleware, OutgoingContext } from '../middleware'
import { OutgoingMessage } from '../outgoing-message'
import {
  MessageDispatched,
  RecordingInMemoryQueue,
  TestCommand,
  TestEvent,
  testMessageTypes
} from '../test'
import {
  InMemoryQueue,
  Transport,
  TransportReplyNotSupported,
  TransportSendOptions
} from '../transport'
import { ClassConstructor } from '../util'
import {
  InMemoryPersistence,
  MessageWorkflowMapping,
  Workflow,
  WorkflowState,
  WorkflowStatus
} from '../workflow'
import { FunctionWorkflow } from '../workflow/define-workflow'
import {
  TaskRan,
  TestReplyingClassWorkflow,
  testReplyingWorkflow,
  testRequestReplyWorkflow,
  TestRequestReplyWorkflowState,
  TestCommand as TestWorkflowCommand
} from '../workflow/test'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

const ENDPOINT_NAME = 'reply-test-endpoint'
const QUEUE_CONFIGURATION = {
  receiveTimeoutMs: 50,
  endpointName: ENDPOINT_NAME
}
const silentLogger = () => Mock.ofType<Logger>().object

/**
 * An in-memory queue that can't send to an endpoint, like a transport written before `sendToAddress` existed
 */
class QueueWithoutReplies extends InMemoryQueue {}
const queueWithoutReplies = (): Transport => {
  const queue = new QueueWithoutReplies()
  Object.defineProperty(queue, 'sendToAddress', { value: undefined })
  return queue
}

/**
 * A message dispatched to a `RecordingInMemoryQueue`
 */
interface Dispatched {
  message: Message
  attributes: MessageAttributes | undefined
  sendOptions: TransportSendOptions | undefined
  address: string | undefined
}

/**
 * Records what reaches the transport, in order
 */
const recordDispatched = (): {
  dispatched: Dispatched[]
  onDispatched: MessageDispatched
} => {
  const dispatched: Dispatched[] = []
  return {
    dispatched,
    onDispatched: (message, attributes, sendOptions, address) => {
      dispatched.push({ message, attributes, sendOptions, address })
    }
  }
}

/**
 * Starts a bus that replies to `TestCommand` with `TestEvent` from `replyingHandler`, and emits each `TestEvent` it
 * receives
 */
const startReplyingBus = async (
  replyingHandler: (ctx: HandlerContext) => Promise<void>,
  transport: Transport,
  middleware: BusMiddleware[] = []
): Promise<{ bus: BusInstance; replies: EventEmitter }> => {
  const replies = new EventEmitter()
  const bus = Bus.configure()
    .withLogger(silentLogger)
    .withMessageTypes(testMessageTypes)
    .withTransport(transport)
    .withMiddleware(...middleware)
    .withHandler(
      handlerFor(TestCommand, async (_command, _attributes, ctx) =>
        replyingHandler(ctx)
      )
    )
    .withHandler(
      handlerFor(TestEvent, (event, attributes) => {
        replies.emit('received', event, attributes)
      })
    )
    .build()
  await bus.initialize()
  await bus.start()
  return { bus, replies }
}

describe('BusInstance reply', () => {
  const requestReplyBetweenWorkflows = (
    replyingWorkflow:
      | ClassConstructor<Workflow<WorkflowState>>
      | FunctionWorkflow<WorkflowState>
  ) => {
    const requests = ['first-request', 'second-request', 'third-request']
    const persistence = new InMemoryPersistence()
    const byRequest: MessageWorkflowMapping<
      TestWorkflowCommand,
      TestRequestReplyWorkflowState
    > = { lookup: message => message.property1, mapsTo: 'request' }
    let bus: BusInstance
    let states: TestRequestReplyWorkflowState[][]

    beforeAll(async () => {
      const repliesHandled = new EventEmitter()
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(testMessageTypes)
        .withPersistence(persistence)
        .withWorkflow(testRequestReplyWorkflow, replyingWorkflow)
        .withMiddleware({
          incoming: async (context, next) => {
            await next()
            if (context.message.$name === TaskRan.NAME) {
              repliesHandled.emit('handled')
            }
          }
        })
        .build()
      await bus.initialize()
      await bus.start()

      let handled = 0
      const allRepliesHandled = new Promise<void>(resolve =>
        repliesHandled.on('handled', () => {
          handled++
          if (handled === requests.length) {
            resolve()
          }
        })
      )
      await Promise.all(
        requests.map(request => bus.send(new TestWorkflowCommand(request)))
      )
      await allRepliesHandled
      states = await Promise.all(
        requests.map(request =>
          persistence.getWorkflowState(
            TestRequestReplyWorkflowState,
            byRequest,
            new TestWorkflowCommand(request),
            { attributes: {}, stickyAttributes: {} },
            true
          )
        )
      )
    })

    afterAll(async () => bus.dispose())

    it('should route each reply to the requesting workflow instance with the default mapping', () => {
      states.forEach((state, index) => {
        expect(state).toHaveLength(1)
        expect(state[0]).toMatchObject({
          $status: WorkflowStatus.Complete,
          request: requests[index],
          reply: requests[index]
        })
      })
    })
  }

  describe('when a workflow declared with defineWorkflow replies to a request from another workflow', () => {
    requestReplyBetweenWorkflows(testReplyingWorkflow)
  })

  describe('when a class workflow replies to a request from another workflow', () => {
    requestReplyBetweenWorkflows(TestReplyingClassWorkflow)
  })

  describe('when a handler replies to a request', () => {
    const { dispatched, onDispatched } = recordDispatched()
    const reply = new TestEvent()
    const requestAttributes: Partial<MessageAttributes> = {
      correlationId: 'request-correlation-id',
      attributes: { requestOnly: 'a' },
      stickyAttributes: { workflowId: 'requester-workflow-id', tenant: 't' }
    }
    let bus: BusInstance
    let replyAttributes: MessageAttributes

    beforeAll(async () => {
      let replies: EventEmitter
      ;({ bus, replies } = await startReplyingBus(
        async ctx => ctx.reply(reply),
        new RecordingInMemoryQueue(onDispatched, QUEUE_CONFIGURATION)
      ))
      const received = once(replies, 'received')
      await bus.send(new TestCommand(), requestAttributes)
      ;[, replyAttributes] = (await received) as [TestEvent, MessageAttributes]
    })

    afterAll(async () => bus.dispose())

    it('should stamp the endpoint name of the bus on the request as its return address', () => {
      expect(dispatched[0].attributes!.replyTo).toEqual(ENDPOINT_NAME)
    })

    it('should send the reply straight to the endpoint at the return address', () => {
      expect(dispatched).toHaveLength(2)
      expect(dispatched[1].message).toEqual(reply)
      expect(dispatched[1].address).toEqual(ENDPOINT_NAME)
    })

    it('should give the reply the correlation id and sticky attributes of the request', () => {
      expect(replyAttributes).toMatchObject({
        correlationId: requestAttributes.correlationId,
        stickyAttributes: requestAttributes.stickyAttributes
      })
    })

    it('should not copy the attributes of the request to the reply', () => {
      expect(replyAttributes.attributes).toEqual({})
    })

    it('should give the reply its own message id and the return address of the replier', () => {
      expect(replyAttributes.messageId).toBeDefined()
      expect(replyAttributes.messageId).not.toEqual(
        dispatched[0].attributes!.messageId
      )
      expect(replyAttributes.replyTo).toEqual(ENDPOINT_NAME)
    })
  })

  describe('when a handler replies with attributes of its own', () => {
    let bus: BusInstance
    let replyAttributes: MessageAttributes

    beforeAll(async () => {
      let replies: EventEmitter
      ;({ bus, replies } = await startReplyingBus(
        async ctx =>
          ctx.reply(new TestEvent(), {
            attributes: { replyOnly: 'b' },
            stickyAttributes: { tenant: 'replier' }
          }),
        new InMemoryQueue()
      ))
      const received = once(replies, 'received')
      await bus.send(new TestCommand(), {
        stickyAttributes: { workflowId: 'requester', tenant: 'requester' }
      })
      ;[, replyAttributes] = (await received) as [TestEvent, MessageAttributes]
    })

    afterAll(async () => bus.dispose())

    it('should send the reply with its attributes', () => {
      expect(replyAttributes.attributes).toEqual({ replyOnly: 'b' })
    })

    it('should merge its sticky attributes over those of the request', () => {
      expect(replyAttributes.stickyAttributes).toEqual({
        workflowId: 'requester',
        tenant: 'replier'
      })
    })
  })

  describe('when a handler replies and then throws', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance
    let queue: RecordingInMemoryQueue

    beforeAll(async () => {
      queue = new RecordingInMemoryQueue(onDispatched, {
        receiveTimeoutMs: 50
      })
      ;({ bus } = await startReplyingBus(async ctx => {
        await ctx.reply(new TestEvent())
        throw new Error('Handler failed after replying')
      }, queue))
      const returned = once(queue.settled, 'returned')
      await bus.send(new TestCommand())
      await returned
    })

    afterAll(async () => bus.dispose())

    it('should drop the reply', () => {
      expect(dispatched.map(d => d.message.$name)).toEqual([TestCommand.NAME])
    })
  })

  describe('when outgoing middleware runs for a reply', () => {
    const outgoing = Mock.ofType<(context: OutgoingContext) => void>()
    let bus: BusInstance

    beforeAll(async () => {
      let replies: EventEmitter
      ;({ bus, replies } = await startReplyingBus(
        async ctx => ctx.reply(new TestEvent()),
        new InMemoryQueue(QUEUE_CONFIGURATION),
        [
          {
            outgoing: async (context, next) => {
              outgoing.object({ ...context })
              await next()
            }
          }
        ]
      ))
      const received = once(replies, 'received')
      await bus.send(new TestCommand())
      await received
    })

    afterAll(async () => bus.dispose())

    it('should give the middleware the reply and its destination', () => {
      outgoing.verify(
        o =>
          o(
            It.is<OutgoingContext>(
              context =>
                context.kind === 'reply' &&
                context.destination === ENDPOINT_NAME &&
                context.message.$name === TestEvent.NAME
            )
          ),
        Times.once()
      )
    })
  })

  describe('when a handler replies to a message without a return address', () => {
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const failed = new EventEmitter()
      ;({ bus } = await startReplyingBus(async ctx => {
        replyError = await ctx
          .reply(new TestEvent())
          .catch((error: unknown) => error)
        failed.emit('replied')
      }, new InMemoryQueue()))
      const replied = once(failed, 'replied')
      await bus.send(new TestCommand(), { replyTo: undefined })
      await replied
    })

    afterAll(async () => bus.dispose())

    it('should throw ReturnAddressMissing naming the request and the reply', () => {
      expect(replyError).toBeInstanceOf(ReturnAddressMissing)
      expect(replyError).toMatchObject({
        messageName: TestCommand.NAME,
        replyName: TestEvent.NAME
      })
      expect((replyError as ReturnAddressMissing).help).toBeDefined()
    })
  })

  describe('when a handler context replies after its handler finished', () => {
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const handled = new EventEmitter()
      let keptContext: HandlerContext | undefined
      ;({ bus } = await startReplyingBus(async ctx => {
        keptContext = ctx
        handled.emit('handled')
      }, new InMemoryQueue()))
      const wasHandled = once(handled, 'handled')
      await bus.send(new TestCommand())
      await wasHandled
      replyError = await keptContext!
        .reply(new TestEvent())
        .catch((error: unknown) => error)
    })

    afterAll(async () => bus.dispose())

    it('should throw ReplyOutsideHandlingContext', () => {
      expect(replyError).toBeInstanceOf(ReplyOutsideHandlingContext)
      expect((replyError as ReplyOutsideHandlingContext).replyName).toEqual(
        TestEvent.NAME
      )
    })
  })

  describe('when a kept handler context replies while another message is handled', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const handled = new EventEmitter()
      let firstContext: HandlerContext | undefined
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(testMessageTypes)
        .withTransport(new RecordingInMemoryQueue(onDispatched))
        .withHandler(
          handlerFor(TestCommand, async (_command, attributes, ctx) => {
            if (attributes.attributes.order === 'first') {
              firstContext = ctx
            } else {
              replyError = await firstContext!
                .reply(new TestEvent())
                .catch((error: unknown) => error)
            }
            handled.emit('handled')
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      const firstHandled = once(handled, 'handled')
      await bus.send(new TestCommand(), { attributes: { order: 'first' } })
      await firstHandled
      const secondHandled = once(handled, 'handled')
      await bus.send(new TestCommand(), { attributes: { order: 'second' } })
      await secondHandled
    })

    afterAll(async () => bus.dispose())

    it('should throw ReplyOutsideHandlingContext', () => {
      expect(replyError).toBeInstanceOf(ReplyOutsideHandlingContext)
    })

    it('should not send a reply', () => {
      expect(dispatched.filter(d => d.address !== undefined)).toHaveLength(0)
    })
  })

  describe('when a handler replies from a timer that fires after the handler resolved', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const replied = new EventEmitter()
      ;({ bus } = await startReplyingBus(async ctx => {
        setTimeout(() => {
          ctx.reply(new TestEvent()).then(
            () => replied.emit('replied', undefined),
            (error: unknown) => replied.emit('replied', error)
          )
        }, 20)
      }, new RecordingInMemoryQueue(onDispatched)))
      const wasReplied = once(replied, 'replied')
      await bus.send(new TestCommand())
      ;[replyError] = await wasReplied
    })

    afterAll(async () => bus.dispose())

    it('should throw ReplyOutsideHandlingContext', () => {
      expect(replyError).toBeInstanceOf(ReplyOutsideHandlingContext)
    })

    it('should not send a reply', () => {
      expect(dispatched.filter(d => d.address !== undefined)).toHaveLength(0)
    })
  })

  describe('when a handler sends a delayed command', () => {
    /**
     * Records the messages it stores to send later
     */
    class RecordingPersistence extends InMemoryPersistence {
      readonly stored: OutgoingMessage[] = []

      async storeOutgoingMessages(
        outgoingMessages: OutgoingMessage[]
      ): Promise<string[]> {
        this.stored.push(...outgoingMessages)
        return super.storeOutgoingMessages(outgoingMessages)
      }
    }
    const persistence = new RecordingPersistence()
    let bus: BusInstance
    let delayedAttributes: MessageAttributes

    beforeAll(async () => {
      const delayed = new EventEmitter()
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(testMessageTypes)
        .withTransport(new InMemoryQueue(QUEUE_CONFIGURATION))
        .withPersistence(persistence)
        .withHandler(
          handlerFor(TestCommand, async (_command, attributes, ctx) => {
            if (attributes.attributes.delayed) {
              delayed.emit('received', attributes)
              return
            }
            await ctx.send(new TestCommand(), {
              deliverAfter: 50,
              attributes: { delayed: true }
            })
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      const received = once(delayed, 'received')
      await bus.send(new TestCommand())
      ;[delayedAttributes] = (await received) as [MessageAttributes]
    })

    afterAll(async () => bus.dispose())

    it('should store it with the return address of the bus', () => {
      expect(persistence.stored).toHaveLength(1)
      expect(persistence.stored[0].attributes.replyTo).toEqual(ENDPOINT_NAME)
    })

    it('should send it with the return address once it is due', () => {
      expect(delayedAttributes.replyTo).toEqual(ENDPOINT_NAME)
    })
  })

  describe('when a handler replies with deliverAfter', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const replied = new EventEmitter()
      ;({ bus } = await startReplyingBus(
        async ctx => {
          replyError = await ctx
            .reply(new TestEvent(), {
              deliverAfter: 1_000
            } as Partial<MessageAttributes>)
            .catch((error: unknown) => error)
          replied.emit('replied')
        },
        new RecordingInMemoryQueue(onDispatched, QUEUE_CONFIGURATION)
      ))
      const wasReplied = once(replied, 'replied')
      await bus.send(new TestCommand())
      await wasReplied
    })

    afterAll(async () => bus.dispose())

    it('should throw DelayedReplyNotSupported', () => {
      expect(replyError).toBeInstanceOf(DelayedReplyNotSupported)
      expect((replyError as DelayedReplyNotSupported).replyName).toEqual(
        TestEvent.NAME
      )
    })

    it('should not send a reply', () => {
      expect(dispatched.filter(d => d.address !== undefined)).toHaveLength(0)
    })
  })

  describe('when the transport cannot send to an endpoint', () => {
    let bus: BusInstance
    let replyError: unknown

    beforeAll(async () => {
      const replied = new EventEmitter()
      ;({ bus } = await startReplyingBus(async ctx => {
        replyError = await ctx
          .reply(new TestEvent())
          .catch((error: unknown) => error)
        replied.emit('replied')
      }, queueWithoutReplies()))
      const wasReplied = once(replied, 'replied')
      await bus.send(new TestCommand())
      await wasReplied
    })

    afterAll(async () => bus.dispose())

    it('should throw TransportReplyNotSupported naming the transport', () => {
      expect(replyError).toBeInstanceOf(TransportReplyNotSupported)
      expect(replyError).toMatchObject({
        transportName: 'QueueWithoutReplies',
        replyName: TestEvent.NAME
      })
    })
  })

  describe('when a bus sends and publishes', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(testMessageTypes)
        .withTransport(
          new RecordingInMemoryQueue(onDispatched, QUEUE_CONFIGURATION)
        )
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      await bus.initialize()
      await bus.send(new TestCommand())
      await bus.publish(new TestEvent())
      await bus.send(new TestCommand(), { replyTo: 'another-endpoint' })
      await bus.send(new TestCommand(), { replyTo: undefined })
    })

    afterAll(async () => bus.dispose())

    it('should stamp its endpoint name on commands and events as their return address', () => {
      expect(dispatched[0].attributes!.replyTo).toEqual(ENDPOINT_NAME)
      expect(dispatched[1].attributes!.replyTo).toEqual(ENDPOINT_NAME)
    })

    it('should keep a return address given by the caller', () => {
      expect(dispatched[2].attributes!.replyTo).toEqual('another-endpoint')
    })

    it('should leave out the return address when the caller passes undefined', () => {
      expect(dispatched[3].attributes).not.toHaveProperty('replyTo')
    })
  })

  describe('when a send-only bus sends a message', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(onDispatched, QUEUE_CONFIGURATION)
        )
        .asSendOnly()
        .build()
      await bus.initialize()
      await bus.send(new TestCommand())
    })

    afterAll(async () => bus.dispose())

    it('should not stamp a return address, since it has no queue that is read', () => {
      expect(dispatched[0].attributes).not.toHaveProperty('replyTo')
    })
  })

  describe('when a scheduler sends a message', () => {
    const { dispatched, onDispatched } = recordDispatched()
    let scheduler: BusInstance

    beforeAll(async () => {
      scheduler = Bus.configure()
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(onDispatched, QUEUE_CONFIGURATION)
        )
        .withPersistence(new InMemoryPersistence())
        .asScheduler()
        .build()
      await scheduler.initialize()
      await scheduler.start()
      await scheduler.send(new TestCommand())
      await scheduler.publish(new TestEvent())
    })

    afterAll(async () => scheduler.dispose())

    it('should not stamp a return address, since it never reads its queue', () => {
      expect(dispatched).toHaveLength(2)
      dispatched.forEach(({ attributes }) =>
        expect(attributes).not.toHaveProperty('replyTo')
      )
    })
  })
})
