import { ServiceBus } from './service-bus'
import { MemoryQueue } from '../transport'
import { BusState } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Container, inject } from 'inversify'
import { TestContainer } from '../test/test-container'
import { BUS_SYMBOLS } from '../bus-symbols'
import { Logger } from '@node-ts/logger-core'
import { Mock, IMock, Times } from 'typemoq'
import { HandlerRegistry, HandlesMessage } from '../handler'
import { ApplicationBootstrap } from '../application-bootstrap'

const event = new TestEvent()
type Callback = () => void
const CALLBACK = Symbol.for('Callback')

@HandlesMessage(TestEvent)
class TestEventHandler {
  constructor (
    @inject(CALLBACK) private readonly callback: Callback
  ) {
  }

  async handle (_: TestEvent): Promise<void> {
    this.callback()
  }
}

describe('ServiceBus', () => {
  let container: Container

  let sut: ServiceBus
  let bootstrapper: ApplicationBootstrap
  let queue: MemoryQueue

  let callback: IMock<Callback>

  beforeAll(async () => {
    container = new TestContainer().silenceLogs()
    queue = new MemoryQueue(Mock.ofType<Logger>().object)

    const transport = container.get<MemoryQueue>(BUS_SYMBOLS.Transport)
    const registry = container.get<HandlerRegistry>(BUS_SYMBOLS.HandlerRegistry)

    bootstrapper = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    bootstrapper.registerHandler(TestEventHandler)

    callback = Mock.ofType<Callback>()
    container.bind(CALLBACK).toConstantValue(callback.object)
    await transport.initialize(registry)
    await bootstrapper.initialize(container)
    sut = container.get(BUS_SYMBOLS.Bus)
  })

  afterAll(async () => {
    await bootstrapper.dispose()
  })

  describe('when starting the service bus', () => {
    it('should complete into a started state', () => {
      expect(sut.state).toEqual(BusState.Started)
    })

    describe('and then the bus is started again', () => {
      it('should throw an error', async () => {
        await expect(sut.start()).rejects.toThrowError()
      })
    })
  })


  describe('when a message is successfully handled from the queue', () => {
    it('should delete the message from the queue', async () => {
      callback.reset()
      callback
        .setup(c => c())
        .callback(() => undefined)
        .verifiable(Times.once())
      await sut.publish(event)
      await sleep(10)

      expect(queue.depth).toEqual(0)
      callback.verifyAll()
    })
  })

  describe('and a handled message throw an Error', () => {

    it('should return the message for retry', async () => {
      callback.reset()
      let callCount = 0
      callback
        .setup(c => c())
        .callback(() => {
          if (callCount++ === 0) {
            throw new Error()
          }
        })
        .verifiable(Times.exactly(2))

      await sut.publish(event)
      await sleep(2000)

      callback.verifyAll()
    })
  })
})
