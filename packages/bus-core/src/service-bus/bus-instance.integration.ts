import { InMemoryMessage, MemoryQueue, TransportMessage } from '../transport'
import { Bus } from './bus'
import { BusState } from './bus-state'
import { TestEvent } from '../test/test-event'
import { Middleware, sleep } from '../util'
import { Mock, IMock, Times, It } from 'typemoq'
import { handlerFor, SystemMessageMissingResolver } from '../handler'
import { TestCommand } from '../test/test-command'
import { TestEvent2 } from '../test/test-event-2'
import {
  ContainerNotRegistered,
  FailMessageOutsideHandlingContext
} from '../error'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { EventEmitter } from 'stream'
import { TestSystemMessage } from '../test/test-system-message'
import { Command, MessageAttributes } from '@node-ts/bus-messages'
import { toTransportMessage } from '../transport/memory-queue'
import { Logger } from '../logger'
import { BusInstance } from './bus-instance'
import { InvalidBusState } from './error'

const event = new TestEvent()
type Callback = () => void

describe('BusInstance', () => {
  describe('when the bus is configured correctly', () => {
    let bus: BusInstance
    let queue: MemoryQueue
    let callback: IMock<Callback>
    const handler = handlerFor(TestEvent, async (_: TestEvent) =>
      callback.object()
    )
    let messageReadMiddleware: IMock<Middleware<TransportMessage<unknown>>>

    beforeAll(async () => {
      queue = new MemoryQueue()
      callback = Mock.ofType<Callback>()
      messageReadMiddleware =
        Mock.ofType<Middleware<TransportMessage<unknown>>>()

      bus = await Bus.configure()
        .withTransport(queue)
        .withHandler(handler)
        .withMessageReadMiddleware(messageReadMiddleware.object)
        .initialize()
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
        messageReadMiddleware.reset()

        messageReadMiddleware
          .setup(x => x(It.isAny(), It.isAny()))
          .returns((_, next) => next())
          .verifiable(Times.once())

        await bus.start()

        await new Promise(async resolve => {
          callback.reset()
          callback
            .setup(c => c())
            .callback(resolve)
            .verifiable(Times.once())

          await bus.publish(event)
        })
      })

      afterAll(async () => bus.stop())

      it('should delete the message from the queue', async () => {
        expect(queue.depth).toEqual(0)
        callback.verifyAll()
      })

      it('should invoke the message read middlewares', async () => {
        messageReadMiddleware.verifyAll()
      })
    })

    describe('when a handled message throws an Error', () => {
      beforeEach(async () => bus.start())
      afterEach(async () => bus.stop())

      it('should return the message for retry', async () => {
        callback.reset()
        let callCount = 0

        await new Promise<void>(async resolve => {
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

          await bus.publish(event)
        })

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

      it('should trigger error hook if registered', async () => {
        const errorCallback = jest.fn()
        setupErroneousCallback()

        bus.onError.on(errorCallback)
        await bus.publish(event)
        await sleep(2000)

        callback.verifyAll()

        const expectedTransportMessage: TransportMessage<InMemoryMessage> = {
          id: undefined,
          attributes: { attributes: {}, stickyAttributes: {} },
          domainMessage: event,
          raw: {
            inFlight: true,
            seenCount: 1,
            payload: event
          }
        }

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
          rawMessage: expect.objectContaining({
            ...expectedTransportMessage,
            attributes: expect.anything()
          })
        })
        bus.onError.off(errorCallback)
      })
    })

    describe('when registering a send hook', () => {
      const sendCallback = jest.fn()
      const command = new TestCommand()

      beforeAll(async () => {
        bus.beforeSend.on(sendCallback)
        await bus.send(command, { correlationId: 'a' })
        bus.beforeSend.off(sendCallback)
        await bus.send(command, { correlationId: 'a' })
      })

      it('should trigger the hook once when send() is called', async () => {
        expect(sendCallback).toHaveBeenCalledWith({
          command,
          attributes: expect.objectContaining({ correlationId: 'a' })
        })
      })

      it('should only trigger the callback once before its removed', () => {
        expect(sendCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('when registering a publish hook', () => {
      const publishCallback = jest.fn()
      const evt = new TestEvent()

      beforeAll(async () => {
        bus.beforePublish.on(publishCallback)
        await bus.publish(evt, { correlationId: 'b' })
        bus.beforePublish.off(publishCallback)
        await bus.publish(evt, { correlationId: 'b' })
      })

      it('should trigger the hook once when publish() is called', async () => {
        expect(publishCallback).toHaveBeenCalledWith({
          event: evt,
          attributes: expect.objectContaining({ correlationId: 'b' })
        })
      })

      it('should only trigger the callback once before its removed', () => {
        expect(publishCallback).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('when a class handler is used', () => {
    describe('without registering a container', () => {
      it('should throw a ContainerNotRegistered error', async () => {
        await expect(
          Bus.configure()
            .withConcurrency(1)
            .withHandler(TestEventClassHandler)
            .initialize()
        ).rejects.toBeInstanceOf(ContainerNotRegistered)
      })
    })
  })

  describe('when sending a message with sticky attributes', () => {
    describe('which results in another message being sent', () => {
      it('should attach sticky attributes', async () => {
        const events = new EventEmitter()
        const bus = await Bus.configure()
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
          .initialize()

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
    it('should fail when a custom resolver is not provided', async () => {
      try {
        await Bus.configure()
          .withHandler(handlerFor(TestSystemMessage, async () => undefined))
          .initialize()
        fail('Registry should throw an SystemMessageMissingResolver error')
      } catch (error) {
        console.log(error)
        expect(error).toBeInstanceOf(SystemMessageMissingResolver)
      }
    })

    it('should handle the external message', async () => {
      const events = new EventEmitter()
      const queue = new MemoryQueue()
      const bus = await Bus.configure()
        .withTransport(queue)
        .withCustomHandler(
          async (message: TestSystemMessage) => {
            events.emit('event', message)
          },
          {
            resolveWith: m => m.name === TestSystemMessage.NAME
          }
        )
        .initialize()

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
      const queue = Mock.ofType<MemoryQueue>()
      const events = new EventEmitter()
      const bus = await Bus.configure()
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .initialize()
      await bus.start()

      queue
        .setup(q => q.readNextMessage())
        .callback(async () => {
          await bus.stop()
          events.emit('event')
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
      const queue = Mock.ofType<MemoryQueue>()
      const events = new EventEmitter()
      const bus = await Bus.configure()
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .initialize()
      await bus.start()

      queue
        .setup(q => q.readNextMessage())
        .returns(async () => ({ domainMessage: new TestCommand() } as any))

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
        let bus: BusInstance
        try {
          bus = await Bus.configure().initialize()
          await bus.fail()
          fail('Expected FailMessageOutsideHandlingContext to have been thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(FailMessageOutsideHandlingContext)
        } finally {
          await bus.dispose()
        }
      })
    })

    describe('when there is a message handling context', () => {
      it('should fail the message on the transport', async () => {
        const events = new EventEmitter()

        const queue = new MemoryQueue()
        const queueMock = jest.spyOn(queue, 'fail')
        const bus = await Bus.configure()
          .withTransport(queue)
          .withHandler(
            handlerFor(TestCommand, async () => {
              await bus.fail()
              events.emit('event')
            })
          )
          .initialize()

        await bus.start()
        const messageFailed = new Promise<void>(resolve =>
          events.on('event', resolve)
        )
        await bus.send(new TestCommand())
        await messageFailed

        expect(queueMock).toHaveBeenCalled()
        await bus.dispose()
      })
    })
  })
})
