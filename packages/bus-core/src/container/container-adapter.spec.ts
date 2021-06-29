import { Bus } from '../service-bus'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { Mock, Times } from 'typemoq'
import { MessageLogger } from '../test/test-event-handler'
import { TestEvent } from '../../../bus-sqs/test'
import { ClassConstructor, sleep } from '../util'
import { TestEvent2 } from '../test'
import { ClassHandlerNotResolved, ContainerNotRegistered } from '../error'
import { HandlerContext } from '../handler'
import { Message } from '@node-ts/bus-messages'

class UnregisteredClassHandler {
  async handle (_: HandlerContext<TestEvent2>): Promise<void> {
    // ...
  }
}

const waitForError = (onError: (error: Error) => void) => new Promise<void>((resolve, reject) => {
  const callback = (_: Message, error: Error) => {
    try {
      onError(error)
      resolve()
    } catch (e) {
      reject(e)
    } finally {
      Bus.off('error', callback)
    }
  }
  Bus.on('error', callback)
})

describe('ContainerAdapter', () => {
  const event = new TestEvent()
  const messageLogger = Mock.ofType<MessageLogger>()
  const testEventClassHandler = new TestEventClassHandler(messageLogger.object)

  const container: { [key: string]: unknown } = {
    TestEventClassHandler: testEventClassHandler
  }

  afterEach(async () => {
    await Bus.dispose()
    messageLogger.reset()
  })

  describe('when an adapter is installed', () => {
    beforeEach(async () => {
      await Bus
        .configure()
        .withContainer({
          get <T>(type: ClassConstructor<T>) {
            return container[type.name] as T
          }
        })
        .withHandler(TestEvent, TestEventClassHandler)
        .withHandler(TestEvent2, UnregisteredClassHandler)
        .initialize()
      await Bus.start()
    })

    describe('and a handler is registered', () => {
      it('should route the message to the class based handler', async () => {
        await Bus.publish(event)
        await sleep(0)
        messageLogger.verify(m => m.log(event), Times.once())
      })
    })

    describe('and a handler is not registered', () => {
      it('should throw a ClassHandlerNotResolved error', async () => {
        const onError = waitForError(error => {
          expect(error).toBeInstanceOf(ClassHandlerNotResolved)
          const classHandlerNotResolved = error as ClassHandlerNotResolved
          expect(classHandlerNotResolved.reason).toEqual('Container failed to resolve an instance.')
        })
        await Bus.publish(new TestEvent2())
        await onError
      })
    })
  })

  describe('when no adapter is installed', () => {
    beforeEach(async () => {
      await Bus
        .configure()
        .withHandler(TestEvent, TestEventClassHandler)
        .initialize()
      await Bus.start()
    })

    describe('and a handler is registered', () => {
      it('should throw a ContainerNotRegistered error', async () => {
        const onError = waitForError(error => {
          expect(error).toBeInstanceOf(ContainerNotRegistered)
          const containerNotRegistered = error as ContainerNotRegistered
          expect(containerNotRegistered.msg).toEqual(event)
        })
        await Bus.publish(event)
        await onError
      })
    })
  })
})
