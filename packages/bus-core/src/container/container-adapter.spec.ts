import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter } from 'node:events'
import { Mock, Times } from 'typemoq'
import { ClassHandlerNotResolved, ContainerNotRegistered } from '../error'
import { Handler, HandlerDispatchRejected } from '../handler'
import { Logger } from '../logger'
import { BusMiddleware } from '../middleware'
import { retry } from '../recoverability'
import { Bus, BusInstance } from '../service-bus'
import { TestEvent, TestEvent2, testMessageTypes } from '../test'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { MessageLogger } from '../test/test-event-handler'
import { InMemoryQueue, TransportMessage } from '../transport'
import { ClassConstructor, sleep } from '../util'
import { Workflow, WorkflowMapper } from '../workflow'
import { TestWorkflowState } from '../workflow/test'
import { ContainerContext } from './container-context'

// Lets a test see messages handled by UnregisteredClassHandler when the bus constructs it with new
let handled: ((message: TestEvent2) => void) | undefined

class UnregisteredClassHandler implements Handler<TestEvent2> {
  messageType = TestEvent2

  async handle(message: TestEvent2): Promise<void> {
    handled?.(message)
  }
}

const handlingErrors = new EventEmitter()

/**
 * Passes each error that fails the handling of a message to `waitForError`, then rethrows it
 */
const reportHandlingErrors: BusMiddleware = {
  incoming: async (_, next) => {
    try {
      await next()
    } catch (error) {
      handlingErrors.emit('handlingError', error)
      throw error
    }
  }
}

const waitForError = (onError: (error: Error) => void) =>
  new Promise<void>((resolve, reject) => {
    handlingErrors.once('handlingError', (error: Error) => {
      try {
        onError(error)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })

const constructorError = new Error('Missing configuration')

class ThrowingClassHandler implements Handler<TestEvent2> {
  // A getter, so registering the handler reads it without running the constructor
  get messageType() {
    return TestEvent2
  }

  constructor() {
    throw constructorError
  }

  async handle(): Promise<void> {
    // Never reached, the constructor throws
  }
}

describe('ContainerAdapter', () => {
  const event = new TestEvent()
  const messageLogger = Mock.ofType<MessageLogger>()
  const testEventClassHandler = new TestEventClassHandler(messageLogger.object)
  let bus: BusInstance

  const container: { [key: string]: unknown } = {
    TestEventClassHandler: testEventClassHandler,
    'some-message-id': {
      TestEventClassHandler: testEventClassHandler
    }
  }

  afterEach(async () => {
    messageLogger.reset()
  })

  describe('when an adapter is installed', () => {
    beforeEach(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandlingErrors)
        .withMessageTypes(testMessageTypes)
        .withContainer({
          get<T>(type: ClassConstructor<T>) {
            return container[type.name] as T
          }
        })
        .withHandler(TestEventClassHandler)
        .withHandler(UnregisteredClassHandler)
        .build()

      await bus.initialize()
      await bus.start()
    })

    afterEach(async () => {
      await bus.dispose()
    })

    describe('and a handler is registered', () => {
      it('should route the message to the class based handler', async () => {
        await bus.publish(event)
        await sleep(0)
        messageLogger.verify(m => m.log(event), Times.once())
      })
    })

    describe('and a handler is not registered', () => {
      it('should throw a ClassHandlerNotResolved error', async () => {
        const onError = waitForError(error => {
          expect(error).toBeInstanceOf(HandlerDispatchRejected)
          const baseError = error as HandlerDispatchRejected
          expect(baseError.rejections[0]).toBeInstanceOf(
            ClassHandlerNotResolved
          )
          const classHandlerNotResolved = baseError
            .rejections[0] as ClassHandlerNotResolved
          expect(classHandlerNotResolved.reason).toEqual(
            'Container failed to resolve an instance.'
          )
          expect(classHandlerNotResolved.classHandlerName).toEqual(
            'UnregisteredClassHandler'
          )
          expect(classHandlerNotResolved.message).toEqual(
            'Unable to resolve class handler UnregisteredClassHandler from the container: Container failed to resolve an instance.'
          )
          expect(baseError.message).toContain(classHandlerNotResolved.message)
          expect(baseError.cause).toBe(classHandlerNotResolved)
        })
        await bus.publish(new TestEvent2())
        await onError
      })
    })
  })
  describe('when the adapter throws', () => {
    const containerError = new Error('No provider for UnregisteredClassHandler')
    let error: Error

    beforeAll(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandlingErrors)
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withContainer({
          get() {
            throw containerError
          }
        })
        .withHandler(UnregisteredClassHandler)
        .build()
      await bus.initialize()
      await bus.start()
      const onError = waitForError(e => {
        error = e
      })
      await bus.publish(new TestEvent2())
      await onError
    })

    afterAll(async () => bus.dispose())

    it('should throw ClassHandlerNotResolved with the container error as its cause', () => {
      const classHandlerNotResolved = (error as HandlerDispatchRejected)
        .rejections[0] as ClassHandlerNotResolved
      expect(classHandlerNotResolved).toBeInstanceOf(ClassHandlerNotResolved)
      expect(classHandlerNotResolved.reason).toEqual(containerError.message)
      expect(classHandlerNotResolved.cause).toBe(containerError)
    })
  })

  describe('when the adapter throws a value that is not an Error', () => {
    let error: Error

    beforeAll(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandlingErrors)
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withContainer({
          get() {
            throw 'boom-string'
          }
        })
        .withHandler(UnregisteredClassHandler)
        .build()
      await bus.initialize()
      await bus.start()
      const onError = waitForError(e => {
        error = e
      })
      await bus.publish(new TestEvent2())
      await onError
    })

    afterAll(async () => bus.dispose())

    it('should keep the thrown value as the reason', () => {
      const classHandlerNotResolved = (error as HandlerDispatchRejected)
        .rejections[0] as ClassHandlerNotResolved
      expect(classHandlerNotResolved.reason).toEqual('boom-string')
      expect(classHandlerNotResolved.message).toContain('boom-string')
    })
  })

  describe('when an async adapter is installed', () => {
    beforeEach(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandlingErrors)
        .withMessageTypes(testMessageTypes)
        .withContainer({
          get<T>(type: ClassConstructor<T>) {
            return Promise.resolve(container[type.name] as T)
          }
        })
        .withHandler(TestEventClassHandler)
        .withHandler(UnregisteredClassHandler)
        .build()
      await bus.initialize()
      await bus.start()
    })

    afterEach(async () => {
      await bus.dispose()
    })

    describe('and a handler is registered', () => {
      it('should route the message to the class based handler', async () => {
        await bus.publish(event)
        await sleep(0)
        messageLogger.verify(m => m.log(event), Times.once())
      })
    })

    describe('and a handler is not registered', () => {
      it('should throw a ClassHandlerNotResolved error', async () => {
        const onError = waitForError(error => {
          expect(error).toBeInstanceOf(HandlerDispatchRejected)
          const baseError = error as HandlerDispatchRejected
          expect(baseError.rejections[0]).toBeInstanceOf(
            ClassHandlerNotResolved
          )
          const classHandlerNotResolved = baseError
            .rejections[0] as ClassHandlerNotResolved
          expect(classHandlerNotResolved.reason).toEqual(
            'Container failed to resolve an instance.'
          )
        })
        await bus.publish(new TestEvent2())
        await onError
      })
    })
  })
  describe('when an async context aware adapter is installed', () => {
    beforeEach(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandlingErrors)
        .withMessageTypes(testMessageTypes)
        .withContainer({
          get<T>(
            type: ClassConstructor<T>,
            context?: {
              message: Message
              messageAttributes: MessageAttributes<{
                messageId: string
              }>
            }
          ) {
            const ctx = container[
              context?.messageAttributes.attributes.messageId as string
            ] as { [key: string]: unknown }
            return Promise.resolve(ctx[type.name] as T)
          }
        })
        .withHandler(TestEventClassHandler)
        .withHandler(UnregisteredClassHandler)
        .build()

      await bus.initialize()
      await bus.start()
    })

    afterEach(async () => {
      await bus.dispose()
    })

    describe('and a handler is registered', () => {
      it('should route the message to the class based handler', async () => {
        await bus.publish(event, {
          attributes: {
            messageId: 'some-message-id'
          }
        })
        await sleep(0)
        messageLogger.verify(m => m.log(event), Times.once())
      })
    })

    describe('and a handler is not registered', () => {
      it('should throw a ClassHandlerNotResolved error', async () => {
        const onError = waitForError(error => {
          expect(error).toBeInstanceOf(HandlerDispatchRejected)
          const baseError = error as HandlerDispatchRejected
          expect(baseError.rejections[0]).toBeInstanceOf(
            ClassHandlerNotResolved
          )
          const classHandlerNotResolved = baseError
            .rejections[0] as ClassHandlerNotResolved
          expect(classHandlerNotResolved.reason).toEqual(
            'Container failed to resolve an instance.'
          )
        })
        await bus.publish(new TestEvent2(), {
          attributes: {
            messageId: 'some-message-id'
          }
        })
        await onError
      })
    })
  })

  describe('when class handlers and workflows are resolved for a message that is retried and sent again', () => {
    const queue = new InMemoryQueue()
    const resolutions: { type: string; context: ContainerContext }[] = []
    const sentEvent = new TestEvent2()
    let failNextHandling = true

    class FailsOnceHandler implements Handler<TestEvent2> {
      get messageType() {
        return TestEvent2
      }

      async handle(): Promise<void> {
        if (failNextHandling) {
          failNextHandling = false
          throw new Error('Failed on the first attempt')
        }
      }
    }

    class StartedByEventWorkflow extends Workflow<TestWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<TestWorkflowState, StartedByEventWorkflow>
      ): void {
        mapper.withState(TestWorkflowState).startedBy(TestEvent2, 'start')
      }

      async start(): Promise<Partial<TestWorkflowState>> {
        return {}
      }
    }

    /**
     * The deliveries the container was given, in the order it first saw them, each with the classes it resolved
     */
    const deliveries = () => {
      const byDelivery = new Map<TransportMessage<unknown>, string[]>()
      for (const { type, context } of resolutions) {
        const delivery = context.transportMessage!
        byDelivery.set(delivery, [...(byDelivery.get(delivery) ?? []), type])
      }
      return [...byDelivery]
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withTransport(queue)
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withRecoverability(() => retry(0))
        .withContainer({
          get<T>(type: ClassConstructor<T>, context?: ContainerContext) {
            // Without a message, the bus is reading a class workflow's configureWorkflow()
            if (context?.message) {
              resolutions.push({ type: type.name, context })
            }
            return new type()
          }
        })
        .withHandler(FailsOnceHandler)
        .withWorkflow(StartedByEventWorkflow)
        .build()
      await bus.initialize()
      await bus.start()

      await bus.publish(sentEvent)
      await queue.idle()
      await bus.publish(sentEvent)
      await queue.idle()
    })

    afterAll(async () => bus.dispose())

    it('should give the class handler and workflow of each delivery the same transport message', () => {
      expect(deliveries().map(([, types]) => types.sort())).toEqual([
        ['FailsOnceHandler', 'StartedByEventWorkflow'],
        ['FailsOnceHandler', 'StartedByEventWorkflow'],
        ['FailsOnceHandler', 'StartedByEventWorkflow']
      ])
    })

    it('should give the retry and the second send transport messages of their own', () => {
      expect(deliveries().map(([delivery]) => delivery.failedAttempts)).toEqual(
        [0, 1, 0]
      )
    })

    it('should give every delivery the same message object, so only the transport message tells them apart', () => {
      const messages = resolutions.map(({ context }) => context.message)
      expect(new Set(messages).size).toEqual(1)
      expect(messages[0]).toBe(sentEvent)
    })

    it('should give the transport message with the message and attributes it carries', () => {
      for (const { context } of resolutions) {
        expect(context.transportMessage!.domainMessage).toBe(context.message)
        expect(context.transportMessage!.attributes).toBe(
          context.messageAttributes
        )
      }
    })
  })

  describe('when no adapter is installed', () => {
    describe('and no class handlers are registered', () => {
      it('should initialize without errors', async () => {
        const bus = Bus.configure().withMessageTypes(testMessageTypes).build()
        await bus.initialize()
        await bus.dispose()
      })
    })

    describe('and a class handler is registered', () => {
      const events = new EventEmitter()
      const received: TestEvent2[] = []

      beforeAll(async () => {
        bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withHandler(UnregisteredClassHandler)
          .build()
        await bus.initialize()
        await bus.start()
        handled = (message: TestEvent2) => {
          received.push(message)
          events.emit('received')
        }
        const handledEvent = new Promise(resolve =>
          events.once('received', resolve)
        )
        await bus.publish(new TestEvent2())
        await handledEvent
      })

      afterAll(async () => {
        handled = undefined
        await bus.dispose()
      })

      it('should construct the handler with new and dispatch to it', () => {
        expect(received).toHaveLength(1)
      })
    })

    describe('and a class handler with constructor arguments is registered', () => {
      let error: unknown

      beforeAll(() => {
        try {
          Bus.configure()
            .withMessageTypes(testMessageTypes)
            .withHandler(TestEventClassHandler)
            .build()
        } catch (e) {
          error = e
        }
      })

      it('should throw ContainerNotRegistered naming the class from build', () => {
        expect(error).toBeInstanceOf(ContainerNotRegistered)
        const containerNotRegistered = error as ContainerNotRegistered
        expect(containerNotRegistered.classHandlerName).toEqual(
          'TestEventClassHandler'
        )
        expect(containerNotRegistered.message).toContain(
          'TestEventClassHandler'
        )
        expect(containerNotRegistered.help).toContain('withContainer')
      })
    })

    describe('and the class handler constructor throws', () => {
      let error: Error

      beforeAll(async () => {
        bus = Bus.configure()
          .withMiddleware(reportHandlingErrors)
          .withMessageTypes(testMessageTypes)
          .withLogger(() => Mock.ofType<Logger>().object)
          .withHandler(ThrowingClassHandler)
          .build()
        await bus.initialize()
        await bus.start()
        const onError = waitForError(e => {
          error = e
        })
        await bus.publish(new TestEvent2())
        await onError
      })

      afterAll(async () => bus.dispose())

      it('should throw ClassHandlerNotResolved naming the class with the constructor error as its cause', () => {
        const rejection = (error as HandlerDispatchRejected).rejections[0]
        expect(rejection).toBeInstanceOf(ClassHandlerNotResolved)
        const classHandlerNotResolved = rejection as ClassHandlerNotResolved
        expect(classHandlerNotResolved.classHandlerName).toEqual(
          'ThrowingClassHandler'
        )
        expect(classHandlerNotResolved.cause).toBe(constructorError)
        expect(error.message).toContain(
          'ClassHandlerNotResolved: Unable to resolve class handler ThrowingClassHandler'
        )
      })
    })
  })
})
