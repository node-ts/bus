import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { HandlerDispatchRejected, handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  BusMiddleware,
  IncomingContext,
  MiddlewareNextCalledTwice,
  OutgoingContext
} from '../middleware'
import { Receiver } from '../receiver'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  TestCommand,
  TestCommand2,
  TestEvent,
  TestEvent2,
  testMessageTypes
} from '../test'
import {
  InMemoryMessage,
  TransportHeaderReserved,
  TransportMessage
} from '../transport'
import {
  InMemoryPersistence,
  Workflow,
  WorkflowMapper,
  WorkflowState
} from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

jest.setTimeout(10_000)

const silentLogger = () => Mock.ofType<Logger>().object

/**
 * Records each stage a middleware runs in, before and after it calls `next()`
 */
const recordingMiddleware = (name: string, calls: string[]): BusMiddleware => ({
  incoming: async (context, next) => {
    calls.push(`${name}:incoming:before:${context.message.$name}`)
    await next()
    calls.push(`${name}:incoming:after:${context.message.$name}`)
  },
  handler: async (context, next) => {
    calls.push(`${name}:handler:before:${context.handlerName}`)
    await next()
    calls.push(`${name}:handler:after:${context.handlerName}`)
  },
  outgoing: async (context, next) => {
    calls.push(`${name}:outgoing:before:${context.message.$name}`)
    await next()
    calls.push(`${name}:outgoing:after:${context.message.$name}`)
  }
})

/**
 * Passes each message a bus received to the host, so incoming middleware runs for messages without a handler too
 */
class PassthroughReceiver implements Receiver<
  Message,
  TransportMessage<unknown>
> {
  async receive(domainMessage: Message): Promise<TransportMessage<unknown>> {
    return {
      id: domainMessage.$name,
      attributes: { attributes: {}, stickyAttributes: {} },
      domainMessage,
      raw: domainMessage
    }
  }
}

class MiddlewareWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-middleware-workflow-state'
  $name = MiddlewareWorkflowState.NAME
}

class MiddlewareWorkflow extends Workflow<MiddlewareWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<MiddlewareWorkflowState, MiddlewareWorkflow>
  ): void {
    mapper.withState(MiddlewareWorkflowState).startedBy(TestCommand, 'start')
  }

  async start(): Promise<Partial<MiddlewareWorkflowState>> {
    return {}
  }
}

describe('BusInstance middleware', () => {
  describe('when middleware is registered for every stage', () => {
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
        .withMiddleware(recordingMiddleware('first', calls))
        .withMiddleware(recordingMiddleware('second', calls))
        .withHandler(
          handlerFor(TestCommand, async function placeOrder(_m, _a, ctx) {
            calls.push('handler')
            await ctx.publish(new TestEvent())
          })
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

    // The command is sent from outside a handler, so the bus may start handling it before its outgoing middleware
    // finishes. Its calls are checked on their own.
    const isCommandSend = (call: string) =>
      call.includes(`outgoing:before:${TestCommand.NAME}`) ||
      call.includes(`outgoing:after:${TestCommand.NAME}`) ||
      call === `transport:${TestCommand.NAME}`

    it('should run outgoing middleware around sending to the transport, in registration order', () => {
      expect(calls.filter(isCommandSend)).toEqual([
        `first:outgoing:before:${TestCommand.NAME}`,
        `second:outgoing:before:${TestCommand.NAME}`,
        `transport:${TestCommand.NAME}`,
        `second:outgoing:after:${TestCommand.NAME}`,
        `first:outgoing:after:${TestCommand.NAME}`
      ])
    })

    it('should run each stage in registration order with the first outermost, and not rerun outgoing middleware when the outbox is flushed', () => {
      expect(calls.filter(call => !isCommandSend(call))).toEqual([
        `first:incoming:before:${TestCommand.NAME}`,
        `second:incoming:before:${TestCommand.NAME}`,
        'first:handler:before:placeOrder',
        'second:handler:before:placeOrder',
        'handler',
        `first:outgoing:before:${TestEvent.NAME}`,
        `second:outgoing:before:${TestEvent.NAME}`,
        `second:outgoing:after:${TestEvent.NAME}`,
        `first:outgoing:after:${TestEvent.NAME}`,
        'second:handler:after:placeOrder',
        'first:handler:after:placeOrder',
        `transport:${TestEvent.NAME}`,
        `second:incoming:after:${TestCommand.NAME}`,
        `first:incoming:after:${TestCommand.NAME}`
      ])
    })
  })

  describe('when incoming middleware does not call next()', () => {
    let bus: BusInstance
    const handled = Mock.ofType<() => void>()
    let deletedMessage: TransportMessage<InMemoryMessage>

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({ incoming: async () => undefined })
        .withHandler(handlerFor(TestCommand, async () => handled.object()))
        .build()

      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      ;[deletedMessage] = await deleted
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should skip the handlers', () => {
      handled.verify(h => h(), Times.never())
    })

    it('should delete the message', () => {
      expect(deletedMessage.domainMessage.$name).toEqual(TestCommand.NAME)
    })
  })

  describe('when incoming middleware throws', () => {
    let bus: BusInstance
    const handled = Mock.ofType<() => void>()
    let returnedMessage: TransportMessage<InMemoryMessage>

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      const events = new EventEmitter()
      let attempts = 0
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          incoming: async (_, next) => {
            if (++attempts === 1) {
              throw new Error('Incoming middleware failed')
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            handled.object()
            events.emit('received')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const returned = once(queue.settled, 'returned')
      const received = once(events, 'received')
      await bus.send(new TestCommand())
      ;[returnedMessage] = await returned
      await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should return the message for retry', () => {
      expect(returnedMessage.domainMessage.$name).toEqual(TestCommand.NAME)
    })

    it('should handle the message when it is retried', () => {
      handled.verify(h => h(), Times.once())
    })
  })

  describe('when incoming middleware catches a handler error without rethrowing it', () => {
    let bus: BusInstance
    const returned = Mock.ofType<() => void>()
    let caught: unknown

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      queue.settled.on('returned', () => returned.object())
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          incoming: async (_, next) => {
            try {
              await next()
            } catch (error) {
              caught = error
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new Error('Handler failed')
          })
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

    it('should give the middleware the handler error', () => {
      expect(caught).toBeInstanceOf(HandlerDispatchRejected)
    })

    it('should mark the message handled instead of returning it', () => {
      returned.verify(r => r(), Times.never())
    })
  })

  describe('when a receiver passes in messages with and without a handler', () => {
    let bus: BusInstance
    const seen: string[] = []

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withReceiver(new PassthroughReceiver())
        .withMiddleware({
          incoming: async (context, next) => {
            seen.push(context.message.$name)
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()

      await bus.initialize()
      await bus.receive(new TestCommand())
      await bus.receive(new TestCommand2())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should run the incoming middleware for both', () => {
      expect(seen).toEqual([TestCommand.NAME, TestCommand2.NAME])
    })
  })

  describe('when handler middleware throws for one of two handlers', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()
    let failure: unknown

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { maxRetries: 0, receiveTimeoutMs: 100 }
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          incoming: async (_, next) => {
            try {
              await next()
            } catch (error) {
              failure = error
              throw error
            }
          },
          handler: async (context, next) => {
            await next()
            if (context.handlerName === 'failingHandler') {
              throw new Error('Handler middleware failed')
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, async function failingHandler(_m, _a, ctx) {
            await ctx.publish(new TestEvent('failing'))
          })
        )
        .withHandler(
          handlerFor(TestCommand, async function passingHandler(_m, _a, ctx) {
            await ctx.publish(new TestEvent2())
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const returned = once(queue.settled, 'returned')
      await bus.send(new TestCommand())
      await returned
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop the sends of the handler it failed', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })

    it('should still flush the sends of the other handler', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent2.NAME })),
        Times.once()
      )
    })

    it('should fail the message as a handler error does', () => {
      expect(failure).toBeInstanceOf(HandlerDispatchRejected)
    })
  })

  describe('when handler middleware does not call next()', () => {
    let bus: BusInstance
    const handled = Mock.ofType<() => void>()
    const returned = Mock.ofType<() => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      queue.settled.on('returned', () => returned.object())
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({ handler: async () => undefined })
        .withHandler(handlerFor(TestCommand, async () => handled.object()))
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

    it('should skip the handler', () => {
      handled.verify(h => h(), Times.never())
    })

    it('should count the handler as succeeded', () => {
      returned.verify(r => r(), Times.never())
    })
  })

  describe('when handler middleware wraps a workflow handler', () => {
    let bus: BusInstance
    const persistence = new InMemoryPersistence()
    const handlerNames: string[] = []
    let statesBefore: number
    let statesAfter: number

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(MiddlewareWorkflowState)
        )
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withWorkflow(MiddlewareWorkflow)
        .withMiddleware({
          handler: async (context, next) => {
            handlerNames.push(context.handlerName)
            statesBefore = persistence.length(MiddlewareWorkflowState)
            await next()
            statesAfter = persistence.length(MiddlewareWorkflowState)
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

    it('should name the handler after the workflow', () => {
      expect(handlerNames).toEqual(['MiddlewareWorkflow'])
    })

    it('should wrap saving the workflow state', () => {
      expect(statesBefore).toEqual(0)
      expect(statesAfter).toEqual(1)
    })
  })

  describe('when outgoing middleware changes the attributes and sets headers', () => {
    let bus: BusInstance
    let sentAttributes: MessageAttributes | undefined
    let sentHeaders: unknown
    let receivedContext: IncomingContext
    let outgoingAttributes: MessageAttributes

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        (message, attributes, sendOptions) => {
          if (message.$name === TestCommand.NAME) {
            sentAttributes = attributes
            sentHeaders = sendOptions?.headers
          }
        }
      )
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          outgoing: async (context, next) => {
            outgoingAttributes = structuredClone(context.attributes)
            context.attributes.attributes.tenant = 'acme'
            context.headers['x-delay'] = 5
            await next()
          },
          incoming: async (context, next) => {
            receivedContext = context
            await next()
            events.emit('received')
          }
        })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()

      await bus.initialize()
      await bus.start()
      const received = once(events, 'received')
      await bus.send(new TestCommand(), { correlationId: 'outgoing-test' })
      await received
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should give outgoing middleware the messageId and sentAt the bus stamped', () => {
      expect(outgoingAttributes.messageId).toEqual(expect.any(String))
      expect(outgoingAttributes.sentAt).toEqual(expect.any(String))
      expect(sentAttributes).toMatchObject({
        messageId: outgoingAttributes.messageId,
        sentAt: outgoingAttributes.sentAt
      })
    })

    it('should send the changed attributes', () => {
      expect(sentAttributes).toMatchObject({
        correlationId: 'outgoing-test',
        attributes: { tenant: 'acme' }
      })
    })

    it('should pass the headers to the transport', () => {
      expect(sentHeaders).toEqual({ 'x-delay': 5 })
    })

    it('should keep the headers on the in-memory message', () => {
      const raw = receivedContext.transportMessage.raw as InMemoryMessage
      expect(raw.headers).toEqual({ 'x-delay': 5 })
    })

    it('should give incoming middleware the attributes', () => {
      expect(receivedContext.attributes.attributes.tenant).toEqual('acme')
    })

    it('should freeze the incoming context', () => {
      expect(Object.isFrozen(receivedContext)).toEqual(true)
    })
  })

  describe('when outgoing middleware does not call next()', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message))
        )
        .withMiddleware({ outgoing: async () => undefined })
        .build()

      await bus.initialize()
      await bus.publish(new TestEvent())
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should drop the message', () => {
      dispatched.verify(d => d(It.isAny()), Times.never())
    })
  })

  describe('when outgoing middleware throws', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()
    const middlewareError = new Error('Outgoing middleware failed')
    let sendError: unknown
    let handlerPublishError: unknown

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message =>
        dispatched.object(message)
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestCommand2.NAME) {
              throw middlewareError
            }
            await next()
            // Throwing after next() still rejects, so the event buffered by next() must be taken back
            if (
              context.kind === 'publish' &&
              (context.message as TestEvent).property1 === 'rejected'
            ) {
              throw middlewareError
            }
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            handlerPublishError = await ctx
              .publish(new TestEvent('rejected'))
              .catch((error: unknown) => error)
            await ctx.publish(new TestEvent2())
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      sendError = await bus.send(new TestCommand2()).catch(error => error)
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject the send', () => {
      expect(sendError).toBe(middlewareError)
    })

    it('should not send the message', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestCommand2.NAME })),
        Times.never()
      )
    })

    it('should reject a publish from a handler', () => {
      expect(handlerPublishError).toBe(middlewareError)
    })

    it('should not buffer the rejected publish', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })

    it('should still flush the other sends of the handler', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent2.NAME })),
        Times.once()
      )
    })
  })

  describe('when a handler publishes a message with a reserved header', () => {
    let bus: BusInstance
    const dispatched = Mock.ofType<(message: Message) => void>()
    let publishError: unknown
    let handlerCalls = 0

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { maxRetries: 0, receiveTimeoutMs: 100 },
        ['x-reserved']
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              context.headers['x-reserved'] = 'value'
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            handlerCalls++
            await ctx.publish(new TestEvent2())
            try {
              await ctx.publish(new TestEvent())
            } catch (error) {
              publishError = error
              throw error
            }
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const returned = once(queue.settled, 'returned')
      await bus.send(new TestCommand())
      await returned
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject the publish itself', () => {
      expect(publishError).toBeInstanceOf(TransportHeaderReserved)
    })

    it('should not flush the sibling messages the handler sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent2.NAME })),
        Times.never()
      )
    })

    it('should handle the message once before dead-lettering it', () => {
      expect(handlerCalls).toEqual(1)
    })
  })

  describe('when outgoing middleware changes the attributes and headers after next()', () => {
    let bus: BusInstance
    const sent = new Map<
      string,
      { attributes: MessageAttributes | undefined; headers: unknown }
    >()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        (message, attributes, sendOptions) => {
          sent.set(message.$name, {
            attributes: structuredClone(attributes),
            headers: structuredClone(sendOptions?.headers)
          })
        }
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          outgoing: async (context, next) => {
            context.headers['x-early'] = true
            await next()
            context.attributes.attributes.late = true
            context.attributes.stickyAttributes.late = true
            context.headers['x-late'] = true
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent())
          })
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

    it.each([
      ['sent straight away', TestCommand.NAME],
      ['buffered in a handler', TestEvent.NAME]
    ])(
      'should send a message %s as the middleware left it at next()',
      (_, messageName) => {
        const { attributes, headers } = sent.get(messageName)!
        expect(headers).toEqual({ 'x-early': true })
        expect(attributes!.attributes).not.toHaveProperty('late')
        expect(attributes!.stickyAttributes).not.toHaveProperty('late')
      }
    )
  })

  describe('when incoming middleware fails the message', () => {
    let bus: BusInstance
    let queue: RecordingInMemoryQueue
    const handled = Mock.ofType<() => void>()

    beforeAll(async () => {
      queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          incoming: async context => {
            await context.failMessage()
          }
        })
        .withHandler(handlerFor(TestCommand, async () => handled.object()))
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

    it('should send the message to the dead letter queue', () => {
      expect(queue.deadLetterQueueDepth).toEqual(1)
    })

    it('should skip the handlers', () => {
      handled.verify(h => h(), Times.never())
    })
  })

  describe('when incoming middleware returns the message', () => {
    let bus: BusInstance
    const handled = Mock.ofType<() => void>()
    const returned = Mock.ofType<() => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      queue.settled.on('returned', () => returned.object())
      let attempts = 0
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withMiddleware({
          incoming: async (context, next) => {
            if (++attempts === 1) {
              await context.returnMessage()
              return
            }
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, async () => handled.object()))
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

    it('should return the message instead of deleting it', () => {
      returned.verify(r => r(), Times.once())
    })

    it('should handle the message when it is retried', () => {
      handled.verify(h => h(), Times.once())
    })
  })

  describe('when a receiver passes in a message and incoming middleware throws', () => {
    let bus: BusInstance
    const middlewareError = new Error('Incoming middleware failed')
    let receiveError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withReceiver(new PassthroughReceiver())
        .withMiddleware({
          incoming: async () => {
            throw middlewareError
          }
        })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()

      await bus.initialize()
      receiveError = await bus
        .receive(new TestCommand())
        .catch((error: unknown) => error)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should rethrow the error to the host', () => {
      expect(receiveError).toBe(middlewareError)
    })
  })

  describe('when a receiver passes in a message and incoming middleware does not call next()', () => {
    let bus: BusInstance
    const handled = Mock.ofType<() => void>()
    let receiveError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withReceiver(new PassthroughReceiver())
        .withMiddleware({ incoming: async () => undefined })
        .withHandler(handlerFor(TestCommand, async () => handled.object()))
        .build()

      await bus.initialize()
      receiveError = await bus.receive(new TestCommand()).then(
        () => undefined,
        (error: unknown) => error
      )
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should resolve, so the host deletes the message', () => {
      expect(receiveError).toBeUndefined()
    })

    it('should skip the handlers', () => {
      handled.verify(h => h(), Times.never())
    })
  })

  describe('when a middleware calls next() twice', () => {
    let bus: BusInstance
    let sendError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware({
          outgoing: async (_, next) => {
            await next()
            await next()
          }
        })
        .build()

      await bus.initialize()
      sendError = await bus.send(new TestCommand()).catch(error => error)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should throw MiddlewareNextCalledTwice naming the stage', () => {
      expect(sendError).toBeInstanceOf(MiddlewareNextCalledTwice)
      expect((sendError as MiddlewareNextCalledTwice).stage).toEqual('outgoing')
    })
  })

  describe('when two buses run in the same process', () => {
    let busA: BusInstance
    let busB: BusInstance
    const outgoingA: OutgoingContext[] = []
    const outgoingB: OutgoingContext[] = []
    const incomingA: string[] = []
    const incomingB: string[] = []

    beforeAll(async () => {
      const events = new EventEmitter()
      busB = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware({
          outgoing: async (context, next) => {
            outgoingB.push(context)
            await next()
          },
          incoming: async (context, next) => {
            incomingB.push(context.message.$name)
            await next()
          }
        })
        .asSendOnly()
        .build()
      busA = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withMiddleware({
          outgoing: async (context, next) => {
            outgoingA.push(context)
            await next()
          },
          incoming: async (context, next) => {
            incomingA.push(context.message.$name)
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            // Another bus' send from inside this bus' handler
            await busB.publish(new TestEvent())
            events.emit('received')
          })
        )
        .build()

      await busB.initialize()
      await busA.initialize()
      await busA.start()
      const received = once(events, 'received')
      await busA.send(new TestCommand(), { correlationId: 'bus-a' })
      await received
    })

    afterAll(async () => {
      await busA.dispose()
      await busB.dispose()
    })

    it('should only run the middleware of the bus that sends', () => {
      expect(outgoingA.map(c => c.message.$name)).toEqual([TestCommand.NAME])
      expect(outgoingB.map(c => c.message.$name)).toEqual([TestEvent.NAME])
    })

    it('should only run the incoming middleware of the bus that receives', () => {
      expect(incomingA).toEqual([TestCommand.NAME])
      expect(incomingB).toEqual([])
    })

    it("should not give the other bus' outgoing middleware the handled message's context", () => {
      expect(outgoingB[0].attributes.correlationId).not.toEqual('bus-a')
    })
  })
})
