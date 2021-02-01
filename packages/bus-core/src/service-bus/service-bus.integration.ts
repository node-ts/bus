// tslint:disable:max-classes-per-file
import { ServiceBus } from './service-bus'
import { InMemoryMessage, MemoryQueue, TransportMessage } from '../transport'
import { BusState } from './bus'
import { TestEvent } from '../test/test-event'
import { TestEvent2 } from '../test/test-event-2'
import { TestCommand } from '../test/test-command'
import { sleep } from '../util'
import { Container, inject } from 'inversify'
import { TestContainer } from '../test/test-container'
import { BUS_SYMBOLS } from '../bus-symbols'
import { Logger } from '@node-ts/logger-core'
import { Mock, IMock, Times } from 'typemoq'
import { HandlesMessage } from '../handler'
import { ApplicationBootstrap } from '../application-bootstrap'
import { MessageAttributes } from '@node-ts/bus-messages'
import { BusConfiguration } from './bus-configuration'

const event = new TestEvent()
type Callback = () => void
const CALLBACK = Symbol.for('Callback')
const LONG_PERIOD_MS = 3000

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

@HandlesMessage(TestEvent2)
class TestEvent2Handler {
  constructor (
    @inject(CALLBACK) private readonly callback: Callback
  ) {
  }

  async handle (_: TestEvent2): Promise<void> {
    await sleep(LONG_PERIOD_MS)
    this.callback()
  }
}

describe('ServiceBus', () => {
  describe('for a single concurrency bus', () => {
    let container: Container

    let sut: ServiceBus
    let bootstrapper: ApplicationBootstrap
    let queue: MemoryQueue

    let callback: IMock<Callback>

    beforeAll(async () => {
      container = new TestContainer().silenceLogs()
      queue = new MemoryQueue(
        Mock.ofType<Logger>().object,
        container.get(BUS_SYMBOLS.HandlerRegistry)
      )

      bootstrapper = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
      bootstrapper.registerHandler(TestEventHandler)

      callback = Mock.ofType<Callback>()
      container.bind(CALLBACK).toConstantValue(callback.object)
      await bootstrapper.initialize(container)
      sut = container.get(BUS_SYMBOLS.Bus)
    })

    afterAll(async () => {
      await bootstrapper.dispose()
    })

    describe('when registering a send hook', () => {
      const sendCallback = jest.fn()
      const command = new TestCommand()

      beforeAll(async () => {
        sut.on('send', sendCallback)
        await sut.send(command)
        sut.off('send', sendCallback)
        await sut.send(command)
      })

      it('should trigger the hook once when send() is called', async () => {
        expect(sendCallback).toHaveBeenCalledWith(command, expect.any(MessageAttributes))
      })

      it('should only trigger the callback once before its removed', () => {
        expect(sendCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('when registering a publish hook', () => {
      const publishCallback = jest.fn()
      const evt = new TestEvent2()

      beforeAll(async () => {
        sut.on('publish', publishCallback)
        await sut.publish(evt)
        sut.off('publish', publishCallback)
        await sut.publish(evt)
      })

      it('should trigger the hook once when publish() is called', async () => {
        expect(publishCallback).toHaveBeenCalledWith(evt, expect.any(MessageAttributes))
      })

      it('should only trigger the callback once before its removed', () => {
        expect(publishCallback).toHaveBeenCalledTimes(1)
      })
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
      // Set up the callback to fail during first call and pass for the subsequent calls
      const setupErroneousCallback = () => {
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
      }

      it('should return the message for retry', async () => {
        setupErroneousCallback()

        await sut.publish(event)
        await sleep(2000)

        callback.verifyAll()
      })

      it('should trigger error hook if registered', async () => {
        const errorCallback = jest.fn()
        setupErroneousCallback()

        sut.on('error', errorCallback)
        await sut.publish(event)
        await sleep(2000)

        callback.verifyAll()

        const expectedTransportMessage: TransportMessage<InMemoryMessage> = {
          id: undefined,
          attributes: new MessageAttributes(),
          domainMessage: event,
          raw: {
            inFlight: true,
            seenCount: 1,
            payload: event
          }
        }

        expect(errorCallback).toHaveBeenCalledTimes(1)
        expect(errorCallback).toHaveBeenCalledWith(
          event,
          expect.any(Error),
          /*
           We can't use expect.any() here because
            messageAttributes wasn't deserialized during transport.
           */
          expect.objectContaining({
            correlationId: undefined,
            attributes: expect.anything(),
            stickyAttributes: expect.anything()
          }),
          expect.objectContaining(expectedTransportMessage)
        )
        sut.off('error', errorCallback)
      })
    })
  })

  describe('when running with concurrency greater than 1', () => {
    const concurrency = 3
    const slowEvent = new TestEvent2()
    let container: Container

    let sut: ServiceBus
    let bootstrapper: ApplicationBootstrap

    let callback: IMock<Callback>

    beforeAll(async () => {
      container = new TestContainer().silenceLogs()

      container
        .rebind<BusConfiguration>(BUS_SYMBOLS.BusConfiguration)
        .toConstantValue({ concurrency })

      bootstrapper = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
      bootstrapper.registerHandler(TestEvent2Handler)

      callback = Mock.ofType<Callback>()
      container.bind(CALLBACK).toConstantValue(callback.object)
      await bootstrapper.initialize(container)
      sut = container.get(BUS_SYMBOLS.Bus)
    })

    afterAll(async () => {
      await bootstrapper.dispose()
    })

    describe('when handling multiple messages', () => {
      beforeAll(async () => {
        callback.reset()
        callback
          .setup(c => c())
          .verifiable(Times.exactly(concurrency))

        await Promise.all(new Array(concurrency)
          .fill(slowEvent)
          .map(e => sut.publish(e))
        )

        /*
          Each handle of the message takes 3 seconds to process. With 3 instances
          this will take 9 seconds+ to complete with a concurrency of 1. Given a
          concurrency of 3 we expect all messages to finish processing before the
          test times out.
        */
        const TEST_GRACE_PERIOD = 1000
        await sleep(LONG_PERIOD_MS + TEST_GRACE_PERIOD)
      })

      it('should handle all messages concurrently', async () => {
        callback.verifyAll()
      })

      it('should start the correct number of workers', async () => {
        expect(sut.runningParallelWorkerCount).toEqual(concurrency)
      })
    })
  })
})
