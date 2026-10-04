import { Command, MessageAttributes } from '@node-ts/bus-messages'
import { once } from 'node:events'
import { EventEmitter } from 'stream'
import { IMock, It, Mock, Times } from 'typemoq'
import { FailMessageOutsideHandlingContext } from '../error'
import { MessageNameMissing, handlerFor } from '../handler'
import { Logger } from '../logger'
import { IncomingContext, Middleware } from '../middleware'
import { MessageFailure } from '../recoverability'
import {
  RecordingInMemoryQueue,
  TestCommandContextClassHandler,
  testMessageTypes
} from '../test'
import { TestCommand } from '../test/test-command'
import { TestCommand2 } from '../test/test-command-2'
import { TestEvent } from '../test/test-event'
import { TestEvent2 } from '../test/test-event-2'
import { TestSystemMessage } from '../test/test-system-message'
import { InMemoryQueue } from '../transport'
import { toTransportMessage } from '../transport/in-memory-queue'
import { sleep } from '../util'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { BusState } from './bus-state'
import { InvalidBusState } from './error'

const event = new TestEvent()
type Callback = () => void

describe('BusInstance', () => {
  describe('when the bus is configured correctly', () => {
    let bus: BusInstance
    let queue: InMemoryQueue
    let callback: IMock<Callback>
    const handler = handlerFor(TestEvent, async (_: TestEvent) =>
      callback.object()
    )
    let incomingMiddleware: IMock<Middleware<IncomingContext>>

    beforeAll(async () => {
      queue = new InMemoryQueue()
      callback = Mock.ofType<Callback>()
      incomingMiddleware = Mock.ofType<Middleware<IncomingContext>>()

      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(queue)
        .withHandler(handler)
        .withMiddleware({
          incoming: async (context, next) =>
            incomingMiddleware.object(context, next)
        })
        .build()
      await bus.initialize()
    })

    describe('when starting the service bus', () => {
      it('should complete into a started state', async () => {
        await bus.start()
        expect(bus.state).toEqual(BusState.Started)
        await bus.stop()
      })

      describe('and then the bus is started again', () => {
        it('should throw an error', async () => {
          await bus.start()
          await expect(bus.start()).rejects.toThrow(InvalidBusState)
          await bus.stop()
        })
      })
    })

    describe('when stopping the service bus', () => {
      describe('when its started', () => {
        it('should stop the bus', async () => {
          await bus.start()
          await bus.stop()
          expect(bus.state).toEqual(BusState.Stopped)
        })
      })

      describe('when its not started', () => {
        it('should throw an error', async () => {
          await expect(bus.stop()).rejects.toThrow(InvalidBusState)
        })
      })
    })

    describe('when a message is successfully handled from the queue', () => {
      beforeAll(async () => {
        incomingMiddleware.reset()

        incomingMiddleware
          .setup(x => x(It.isAny(), It.isAny()))
          .returns(async (_, next) => next())
          .verifiable(Times.once())

        await bus.start()

        const received = new Promise(resolve => {
          callback.reset()
          callback
            .setup(c => c())
            .callback(resolve)
            .verifiable(Times.once())
        })
        await bus.publish(event)
        await received
      })

      afterAll(async () => bus.stop())

      it('should delete the message from the queue', async () => {
        expect(queue.depth).toEqual(0)
        callback.verifyAll()
      })

      it('should invoke the incoming middleware', async () => {
        incomingMiddleware.verifyAll()
      })
    })

    describe('when a handled message throws an Error', () => {
      beforeEach(async () => bus.start())
      afterEach(async () => bus.stop())

      it('should return the message for retry', async () => {
        callback.reset()
        let callCount = 0

        const retried = new Promise<void>(resolve => {
          callback
            .setup(c => c())
            .callback(() => {
              if (callCount++ === 0) {
                throw new Error()
              } else {
                resolve()
              }
            })
            .verifiable(Times.exactly(2))
        })
        await bus.publish(event)
        await retried

        callback.verifyAll()
      })

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

      it('should pass the error to incoming middleware', async () => {
        const errorCallback = jest.fn()
        setupErroneousCallback()

        incomingMiddleware.reset()
        incomingMiddleware
          .setup(x => x(It.isAny(), It.isAny()))
          .returns(async (context, next) => {
            try {
              await next()
            } catch (error) {
              errorCallback({
                message: context.message,
                error,
                attributes: context.attributes,
                rawMessage: context.transportMessage
              })
              throw error
            }
          })
        await bus.publish(event)
        await sleep(2000)

        callback.verifyAll()

        expect(errorCallback).toHaveBeenCalledTimes(1)
        expect(errorCallback).toHaveBeenCalledWith({
          message: event,
          error: expect.any(Error),
          /*
            We can't use expect.any() here because
            messageAttributes wasn't deserialized during transport.
          */
          attributes: expect.objectContaining({
            correlationId: expect.stringContaining('-'),
            attributes: expect.anything(),
            stickyAttributes: expect.anything()
          }),
          rawMessage: expect.objectContaining({ domainMessage: event })
        })
      })
    })
  })

  describe('when a class handler is used', () => {
    describe('without registering a container', () => {
      const events = new EventEmitter()
      const published: TestEvent[] = []
      let bus: BusInstance

      beforeAll(async () => {
        bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withLogger(() => Mock.ofType<Logger>().object)
          .withHandler(TestCommandContextClassHandler)
          .withHandler(
            handlerFor(TestEvent, testEvent => {
              published.push(testEvent)
              events.emit('received')
            })
          )
          .build()
        await bus.initialize()
        await bus.start()

        const received = new Promise(resolve =>
          events.once('received', resolve)
        )
        await bus.send(new TestCommand2())
        await received
      })

      afterAll(async () => bus.dispose())

      it('should construct the handler with new and dispatch to it', () => {
        expect(published).toEqual([
          expect.objectContaining({ property1: 'from-class-handler' })
        ])
      })
    })
  })

  describe('when a message is sent to a bus that has been idle', () => {
    const events = new EventEmitter()
    let bus: BusInstance
    let handlingDelay: number

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TestEvent, () => events.emit('received')))
        .build()
      await bus.initialize()
      await bus.start()
      // Past the in-memory queue's 1 s receive timeout, so the first read has come back empty
      await sleep(1_100)

      const received = new Promise(resolve => events.once('received', resolve))
      const publishedAt = Date.now()
      await bus.publish(new TestEvent())
      await received
      handlingDelay = Date.now() - publishedAt
    })

    afterAll(async () => bus.dispose())

    it('should handle it without sleeping after the empty read', () => {
      // The bus used to sleep 500 ms after every empty read, even one that had already waited for a message
      expect(handlingDelay).toBeLessThan(250)
    })
  })

  describe('when sending a message with sticky attributes', () => {
    describe('which results in another message being sent', () => {
      it('should attach sticky attributes', async () => {
        const events = new EventEmitter()
        const bus: BusInstance = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withHandler(
            handlerFor(
              TestCommand,
              async () => await bus.send(new TestEvent2())
            )
          )
          .withHandler(
            handlerFor(TestEvent2, async () => bus.send(new TestEvent()))
          )
          .withHandler(
            handlerFor(
              TestEvent,
              async (_: TestEvent, { stickyAttributes }: MessageAttributes) => {
                events.emit('event', stickyAttributes)
              }
            )
          )
          .build()

        await bus.initialize()
        await bus.start()

        const stickyAttributes = { test: 'attribute' }
        const eventReceived = new Promise(resolve =>
          events.on('event', resolve)
        )
        await bus.send(new TestCommand(), { stickyAttributes })

        const actualStickyAttributes = await eventReceived
        expect(actualStickyAttributes).toEqual(stickyAttributes)

        await bus.dispose()
      })
    })
  })

  describe('when handling messages originating from an external system', () => {
    it('should fail when a custom resolver is not provided', () => {
      class ExternalMessage {
        readonly bucket = 'uploads'
      }
      expect(() =>
        Bus.configure()
          .withMessageTypes(testMessageTypes)
          // @ts-expect-error a message type without a static NAME and a $name doesn't type check
          .withHandler(handlerFor(ExternalMessage, async () => undefined))
          .build()
      ).toThrow(MessageNameMissing)
    })

    it('should handle the external message', async () => {
      const events = new EventEmitter()
      const queue = new InMemoryQueue()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(queue)
        .withCustomHandler(
          async (message: TestSystemMessage) => {
            events.emit('event', message)
          },
          {
            resolveWith: m => m.name === TestSystemMessage.NAME
          }
        )
        .build()

      await bus.initialize()
      await bus.start()

      const systemMessageReceived = new Promise(resolve =>
        events.on('event', resolve)
      )
      const systemMessage = new TestSystemMessage()
      const transportSystemMessage = toTransportMessage(
        systemMessage as unknown as Command,
        { attributes: {}, stickyAttributes: {} },
        false
      )
      queue['queue'].push(transportSystemMessage)

      const actualSystemMessage = await systemMessageReceived
      expect(actualSystemMessage).toEqual(systemMessage)

      await bus.dispose()
    })
  })

  describe('when a failure occurs when receiving the next message from the transport', () => {
    it('should log the error', async () => {
      const logger = Mock.ofType<Logger>()
      const queue = Mock.ofType<InMemoryQueue>()
      const events = new EventEmitter()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .build()

      await bus.initialize()
      await bus.start()

      queue
        .setup(q => q.readNextMessage())
        .callback(() => {
          // The mock can't await the stop, so the test waits for 'event' instead
          void bus.stop().then(() => events.emit('event'))
        })
        .throws(new Error())

      await new Promise<void>(resolve => events.on('event', resolve))

      logger.verify(
        l =>
          l.error(
            `Failed to handle and dispatch message from transport`,
            It.isAny()
          ),
        Times.once()
      )
      await bus.dispose()
    })
  })

  describe('when there are no handlers for the incoming message', () => {
    it('should log an error', async () => {
      const logger = Mock.ofType<Logger>()
      const queue = Mock.ofType<InMemoryQueue>()
      const events = new EventEmitter()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .build()

      await bus.initialize()
      await bus.start()

      queue
        .setup(q => q.readNextMessage())
        .returns(async () =>
          toTransportMessage(
            new TestCommand(),
            { attributes: {}, stickyAttributes: {} },
            true
          )
        )

      queue
        .setup(q => q.readNextMessage())
        .callback(() => events.emit('event'))
        .returns(async () => undefined)

      await new Promise<void>(resolve => events.on('event', resolve))

      logger.verify(
        l =>
          l.error(
            `No handlers registered for message. Message will be discarded`,
            It.isAny()
          ),
        Times.once()
      )
      await bus.dispose()
    })
  })

  describe('when failing a message', () => {
    describe('when there is no message handling context', () => {
      it('should throw a FailMessageOutsideHandlingContext error', async () => {
        let bus: BusInstance | undefined
        try {
          bus = Bus.configure().withMessageTypes(testMessageTypes).build()
          await bus.failMessage()
          fail('Expected FailMessageOutsideHandlingContext to have been thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(FailMessageOutsideHandlingContext)
        } finally {
          if (bus) {
            await bus.dispose()
          }
        }
      })
    })

    describe('when there is a message handling context', () => {
      it('should fail the message on the transport once the handler finishes', async () => {
        const queue = new RecordingInMemoryQueue(() => undefined)
        const bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withTransport(queue)
          .withHandler(
            handlerFor(TestCommand, async () => {
              await bus.failMessage()
            })
          )
          .build()

        await bus.initialize()
        await bus.start()
        const messageFailed = once(queue.settled, 'failed')
        await bus.send(new TestCommand())
        const [, failure] = (await messageFailed) as [unknown, MessageFailure]

        expect(failure.error.name).toEqual('FailMessageRequested')
        expect(queue.deadLetterQueueDepth).toEqual(1)
        await bus.dispose()
      })
    })
  })

  describe('when stopping a bus that has not been started', () => {
    let error: InvalidBusState
    let sut: BusInstance

    beforeAll(async () => {
      sut = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .build()
      await sut.initialize()
      error = await sut.stop().catch(e => e)
    })

    afterAll(async () => sut.dispose())

    it('should report the started states as the expected states', () => {
      expect(error).toBeInstanceOf(InvalidBusState)
      expect(error.expectedState).toEqual([BusState.Started, BusState.Starting])
    })
  })

  describe('when the bus is stopped immediately after starting', () => {
    const events = new EventEmitter()
    let sut: BusInstance
    let activeHandlers = 0
    let maxActiveHandlers = 0

    beforeAll(async () => {
      sut = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withConcurrency(1)
        .withHandler(
          handlerFor(TestEvent, async () => {
            activeHandlers++
            maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers)
            await sleep(50)
            activeHandlers--
            events.emit('received')
          })
        )
        .build()
      await sut.initialize()

      await sut.start()
      await sut.stop()
      await sut.start()

      let receivedCount = 0
      const allReceived = new Promise<void>(resolve =>
        events.on('received', () => ++receivedCount === 2 && resolve())
      )
      await sut.publish(new TestEvent())
      await sut.publish(new TestEvent())
      await allReceived
    })

    afterAll(async () => sut.dispose())

    it('should not leave workers running from the first start', () => {
      expect(maxActiveHandlers).toEqual(1)
    })
  })

  describe('when the bus is stopped while it is starting', () => {
    let sut: BusInstance
    let releaseStart: () => void

    class SlowStartingQueue extends InMemoryQueue {
      readonly started = new Promise<void>(resolve => (releaseStart = resolve))

      async start(): Promise<void> {
        await this.started
      }
    }

    beforeAll(async () => {
      sut = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(new SlowStartingQueue())
        .build()
      await sut.initialize()

      const starting = sut.start()
      await sut.stop()
      releaseStart()
      await starting
    })

    afterAll(async () => sut.dispose())

    it('should remain stopped once the transport has started', () => {
      expect(sut.state).toEqual(BusState.Stopped)
    })
  })

  describe('when disposing the bus while it is stopping', () => {
    const events = new EventEmitter()
    let sut: BusInstance
    let releaseHandler: () => void
    let stateWhileDisposing: BusState
    let stopResult: Promise<void>

    beforeAll(async () => {
      const handlerReleased = new Promise<void>(
        resolve => (releaseHandler = resolve)
      )
      sut = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(
          handlerFor(TestEvent, async () => {
            events.emit('received')
            await handlerReleased
          })
        )
        .build()
      await sut.initialize()
      await sut.start()

      const received = new Promise(resolve => events.once('received', resolve))
      await sut.publish(new TestEvent())
      await received

      stopResult = sut.stop()
      stateWhileDisposing = sut.state
      const disposing = sut.dispose()
      releaseHandler()
      await disposing
      await stopResult
    })

    it('should dispose while the bus was stopping', () => {
      expect(stateWhileDisposing).toEqual(BusState.Stopping)
    })

    it('should wait for the bus to stop', () => {
      expect(sut.state).toEqual(BusState.Stopped)
    })
  })
})
