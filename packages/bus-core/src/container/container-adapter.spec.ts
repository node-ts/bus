import { Bus, BusInstance, OnError } from '../service-bus'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { Mock, Times } from 'typemoq'
import { MessageLogger } from '../test/test-event-handler'
import { ClassConstructor, Listener, sleep } from '../util'
import { TestEvent, TestEvent2 } from '../test'
import { ClassHandlerNotResolved, ContainerNotRegistered } from '../error'
import { Handler, HandlerDispatchRejected } from '../handler'
import { Message, MessageAttributes } from '@node-ts/bus-messages'

class UnregisteredClassHandler implements Handler<TestEvent2> {
  messageType = TestEvent2

  async handle(_: TestEvent2): Promise<void> {
    // ...
  }
}

const waitForError = (bus: BusInstance, onError: (error: Error) => void) =>
  new Promise<void>((resolve, reject) => {
    const callback: Listener<OnError<unknown>> = ({ error }) => {
      try {
        onError(error)
        resolve()
      } catch (e) {
        reject(e)
      } finally {
        bus.onError.off(callback)
      }
    }
    bus.onError.on(callback)
  })

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
        const onError = waitForError(bus, error => {
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
  describe('when an async adapter is installed', () => {
    beforeEach(async () => {
      bus = Bus.configure()
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
        const onError = waitForError(bus, error => {
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
        const onError = waitForError(bus, error => {
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

  describe('when no adapter is installed', () => {
    describe('and no class handlers are registered', () => {
      it('should initialize without errors', async () => {
        const bus = Bus.configure().build()
        await bus.initialize()
        await bus.dispose()
      })
    })

    describe('and a handler is registered', () => {
      it('should throw a ContainerNotRegistered error', async () => {
        let bus: BusInstance | undefined = undefined
        try {
          bus = Bus.configure().withHandler(TestEventClassHandler).build()
          await bus.initialize()
          fail('Bus initialization should throw a ContainerNotRegistered error')
        } catch (error) {
          expect(error).toBeInstanceOf(ContainerNotRegistered)
        } finally {
          await bus?.dispose()
        }
      })
    })
  })
})
