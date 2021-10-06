import { Bus, BusInstance } from '../service-bus'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { Mock, Times } from 'typemoq'
import { MessageLogger } from '../test/test-event-handler'
import { ClassConstructor, sleep } from '../util'
import { TestEvent, TestEvent2 } from '../test'
import { ClassHandlerNotResolved, ContainerNotRegistered } from '../error'
import { Handler } from '../handler'

class UnregisteredClassHandler implements Handler<TestEvent2> {
  messageType = TestEvent2

  async handle (_: TestEvent2): Promise<void> {
    // ...
  }
}

const waitForError = (
  bus: BusInstance,
  onError: (error: Error) => void) => new Promise<void>((resolve, reject) => {
    const callback = ({ error }) => {
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
    TestEventClassHandler: testEventClassHandler
  }

  afterEach(async () => {
    messageLogger.reset()
  })

  describe('when an adapter is installed', () => {
    beforeEach(async () => {
      bus = await Bus
        .configure()
        .withContainer({
          get <T>(type: ClassConstructor<T>) {
            return container[type.name] as T
          }
        })
        .withHandler(TestEventClassHandler)
        .withHandler(UnregisteredClassHandler)
        .initialize()
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
          expect(error).toBeInstanceOf(ClassHandlerNotResolved)
          const classHandlerNotResolved = error as ClassHandlerNotResolved
          expect(classHandlerNotResolved.reason).toEqual('Container failed to resolve an instance.')
        })
        await bus.publish(new TestEvent2())
        await onError
      })
    })
  })

  describe('when no adapter is installed', () => {
    describe('and no class handlers are registered', () => {
      it('should initialize without errors', async () => {
        const bus = await Bus.configure().initialize()
        await bus.dispose()
      })
    })

    describe('and a handler is registered', () => {
      it('should throw a ContainerNotRegistered error', async () => {
        let bus: BusInstance
        try {
          bus = await Bus
            .configure()
            .withHandler(TestEventClassHandler)
            .initialize()
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
