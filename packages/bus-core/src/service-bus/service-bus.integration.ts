import { InMemoryMessage, MemoryQueue, TransportMessage } from '../transport'
import { Bus, BusState } from './bus'
import { TestEvent } from '../test/test-event'
import { sleep } from '../util'
import { Mock, IMock, Times, It } from 'typemoq'
import { HandlerContext, SystemMessageMissingResolver } from '../handler'
import { TestCommand } from '../test/test-command'
import { TestEvent2 } from '../test/test-event-2'
import { ContainerNotRegistered, FailMessageOutsideHandlingContext } from '../error'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { EventEmitter } from 'stream'
import { TestSystemMessage } from '../test/test-system-message'
import { Command } from '@node-ts/bus-messages'
import { toTransportMessage } from '../transport/memory-queue'
import { Logger } from '../logger'

const event = new TestEvent()
type Callback = () => void;

describe('ServiceBus', () => {
  describe('when the bus is configured correctly', () => {
    let queue: MemoryQueue
    let callback: IMock<Callback>
    const handler = async (_: HandlerContext<TestEvent>) => callback.object()

    beforeAll(async () => {
      queue = new MemoryQueue()
      callback = Mock.ofType<Callback>()

      await Bus.configure()
        .withTransport(queue)
        .withHandler(TestEvent, handler)
        .initialize()
    })

    describe('when starting the service bus', () => {
      it('should complete into a started state', async () => {
        await Bus.start()
        expect(Bus.state).toEqual(BusState.Started)
        await Bus.stop()
      })

      describe('and then the bus is started again', () => {
        it('should throw an error', async () => {
          await Bus.start()
          await expect(Bus.start()).rejects.toThrowError()
          await Bus.stop()
        })
      })
    })

    describe('when stopping the service bus', () => {
      describe('when its started', () => {
        it('should stop the bus', async () => {
          await Bus.start()
          await Bus.stop()
          expect(Bus.state).toEqual(BusState.Stopped)
        })
      })

      describe('when its not started', () => {
        it('should throw an error', async () => {
          await expect(Bus.stop()).rejects.toThrowError()
        })
      })
    })

    describe('when a message is successfully handled from the queue', () => {
      beforeEach(async () => Bus.start())
      afterEach(async () => Bus.stop())

      it('should delete the message from the queue', async () => {
        callback.reset()
        callback
          .setup(c => c())
          .callback(() => undefined)
          .verifiable(Times.once())
        await Bus.publish(event)
        await sleep(10)

        expect(queue.depth).toEqual(0)
        callback.verifyAll()
      })
    })

    describe('when a handled message throws an Error', () => {
      beforeEach(async () => Bus.start())
      afterEach(async () => Bus.stop())

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

        await Bus.publish(event)
        await sleep(2000)

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

        Bus.on('error', errorCallback)
        await Bus.publish(event)
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
        expect(errorCallback).toHaveBeenCalledWith(
          event,
          expect.any(Error),
          /*
            We can't use expect.any() here because
            messageAttributes wasn't deserialized during transport.
          */
          expect.objectContaining({
            correlationId: expect.stringContaining('-'),
            attributes: expect.anything(),
            stickyAttributes: expect.anything()
          }),
          expect.objectContaining({
            ...expectedTransportMessage,
            attributes: expect.anything()
          })
        )
        Bus.off('error', errorCallback)
      })
    })

    describe('when registering a send hook', () => {
      const sendCallback = jest.fn()
      const command = new TestCommand()

      beforeAll(async () => {
        Bus.on('send', sendCallback)
        await Bus.send(command, { correlationId: 'a' })
        Bus.off('send', sendCallback)
        await Bus.send(command, { correlationId: 'a' })
      })

      it('should trigger the hook once when send() is called', async () => {
        expect(sendCallback).toHaveBeenCalledWith(command, expect.objectContaining({ correlationId: 'a' }))
      })

      it('should only trigger the callback once before its removed', () => {
        expect(sendCallback).toHaveBeenCalledTimes(1)
      })
    })

    describe('when registering a publish hook', () => {
      const publishCallback = jest.fn()
      const evt = new TestEvent()

      beforeAll(async () => {
        Bus.on('publish', publishCallback)
        await Bus.publish(evt, { correlationId: 'b' })
        Bus.off('publish', publishCallback)
        await Bus.publish(evt, { correlationId: 'b' })
      })

      it('should trigger the hook once when publish() is called', async () => {
        expect(publishCallback).toHaveBeenCalledWith(evt, expect.objectContaining({ correlationId: 'b' }))
      })

      it('should only trigger the callback once before its removed', () => {
        expect(publishCallback).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('when a class handler is used', () => {
    describe('without registering a container', () => {
      beforeAll(async () => {
        await Bus.dispose()
      })
      it('should throw a ContainerNotRegistered error', async () => {
        await expect(Bus.configure()
          .withConcurrency(1)
          .withHandler(TestEvent, TestEventClassHandler)
          .initialize()
        ).rejects.toBeInstanceOf(ContainerNotRegistered)
      })
    })
  })

  describe('when sending a message with sticky attributes', () => {
    describe('which results in another message being sent', () => {
      it('should attach sticky attributes', async () => {
        await Bus.dispose()

        const events = new EventEmitter()
        await Bus.configure()
          .withHandler(TestCommand, async () => await Bus.send(new TestEvent2()))
          .withHandler(TestEvent2, async () => Bus.send(new TestEvent()))
          .withHandler(TestEvent, async ({ attributes: { stickyAttributes } }: HandlerContext<TestEvent>) => { events.emit('event', stickyAttributes) })
          .initialize()

        await Bus.start()

        const stickyAttributes = { test: 'attribute' }
        const eventReceived = new Promise(resolve => events.on('event', resolve))
        await Bus.send(new TestCommand(), { stickyAttributes })

        const actualStickyAttributes = await eventReceived
        expect(actualStickyAttributes).toEqual(stickyAttributes)

        await Bus.dispose()
      })
    })
  })

  describe('when handling messages originating from an external system', () => {
    it('should fail when a custom resolver is not provided', async () => {
      await Bus.dispose()

      try {
        await Bus.configure()
          .withHandler(TestSystemMessage, async () => undefined)
          .initialize()
        fail('Registry should throw an SystemMessageMissingResolver error')
      } catch (error) {
        console.log(error)
        expect(error).toBeInstanceOf(SystemMessageMissingResolver)
      }
    })

    it('should handle the external message', async () => {
      await Bus.dispose()

      const events = new EventEmitter()
      const queue = new MemoryQueue()
      await Bus.configure()
        .withTransport(queue)
        .withHandler(
          TestSystemMessage,
          async ({ message }: HandlerContext<TestSystemMessage>) => { events.emit('event', message) },
          {
            resolveWith: m => m.name === TestSystemMessage.NAME
          }
        )
        .initialize()

      await Bus.start()

      const systemMessageReceived = new Promise(resolve => events.on('event', resolve))
      const systemMessage = new TestSystemMessage()
      const transportSystemMessage = toTransportMessage(systemMessage as unknown as Command, { attributes: {}, stickyAttributes: {}}, false)
      queue['queue'].push(transportSystemMessage)

      const actualSystemMessage = await systemMessageReceived
      expect(actualSystemMessage).toEqual(systemMessage)

      await Bus.dispose()
    })
  })

  describe('when a failure occurs when receiving the next message from the transport', () => {
    it('should log the error', async () => {
      const logger = Mock.ofType<Logger>()
      const queue = Mock.ofType<MemoryQueue>()
      const events = new EventEmitter()
      await Bus.configure()
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .initialize()
      await Bus.start()

      queue
        .setup(q => q.readNextMessage())
        .callback(async () => {
          await Bus.stop()
          events.emit('event')
        })
        .throws(new Error())

      await new Promise<void>(resolve => events.on('event', resolve))

      logger.verify(
        l => l.error(`Failed to receive message from transport`, It.isAny()),
        Times.once()
      )
      await Bus.dispose()
    })
  })

  describe('when there are no handlers for the incoming message', () => {
    it('should log an error', async () => {
      const logger = Mock.ofType<Logger>()
      const queue = Mock.ofType<MemoryQueue>()
      const events = new EventEmitter()
      await Bus.configure()
        .withTransport(queue.object)
        .withLogger(() => logger.object)
        .initialize()
      await Bus.start()

      queue
        .setup(q => q.readNextMessage())
        .returns(async () => ({ domainMessage: new TestCommand() } as any))

      queue
        .setup(q => q.readNextMessage())
        .callback(() => events.emit('event'))
        .returns(async () => undefined)

      await new Promise<void>(resolve => events.on('event', resolve))

      logger.verify(
        l => l.error(`No handlers registered for message. Message will be discarded`, It.isAny()),
        Times.once()
      )
      await Bus.dispose()
    })
  })

  describe('when failing a message', () => {
    describe('when there is no message handling context', () => {
      it('should throw a FailMessageOutsideHandlingContext error', async () => {
        try {
          await Bus.configure().initialize()
          await Bus.fail()
          fail('Expected FailMessageOutsideHandlingContext to have been thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(FailMessageOutsideHandlingContext)
        } finally {
          await Bus.dispose()
        }
      })
    })

    describe('when there is a message handling context', () => {
      it('should fail the message on the transport', async () => {
        await Bus.dispose()

        const events = new EventEmitter()

        const queue = new MemoryQueue()
        const queueMock = jest.spyOn(queue, 'fail')
        await Bus.configure()
          .withTransport(queue)
          .withHandler(TestCommand, async () => {
            await Bus.fail()
            events.emit('event')
          })
          .initialize()

        await Bus.start()
        const messageFailed = new Promise<void>(resolve => events.on('event', resolve))
        await Bus.send(new TestCommand())
        await messageFailed

        expect(queueMock).toHaveBeenCalled()
        await Bus.dispose()
      })
    })
  })
})
