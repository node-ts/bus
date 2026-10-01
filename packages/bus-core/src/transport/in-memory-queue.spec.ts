import { MessageAttributes } from '@node-ts/bus-messages'
import EventEmitter from 'events'
import { randomUUID } from 'node:crypto'
import { IMock, It, Mock, Times } from 'typemoq'
import { TransportMessage } from '.'
import { sleep } from '../../dist'
import { DefaultHandlerRegistry, handlerFor, HandlerRegistry } from '../handler'
import { Logger, LoggerFactory } from '../logger'
import { RetryStrategy } from '../retry-strategy'
import { JsonSerializer, MessageSerializer } from '../serialization'
import { Bus } from '../service-bus/bus'
import {
  TestCommand,
  TestCommand2,
  TestEvent,
  TestEvent2,
  testMessageTypes
} from '../test'
import { InMemoryMessage, InMemoryQueue } from './in-memory-queue'

const event = new TestEvent()
const command = new TestCommand()
const command2 = new TestCommand2()

describe('InMemoryQueue', () => {
  let sut: InMemoryQueue
  const messageOptions: MessageAttributes = {
    correlationId: randomUUID(),
    attributes: {},
    stickyAttributes: {}
  }

  const handlerRegistry: HandlerRegistry = new DefaultHandlerRegistry()
  let logger: IMock<Logger>
  let loggerFactory: LoggerFactory

  const serializer = new JsonSerializer()
  const messageTypes = { messages: {}, types: {} }
  const messageSerializer = new MessageSerializer(
    serializer,
    handlerRegistry,
    messageTypes
  )

  const retryStrategy = Mock.ofType<RetryStrategy>()

  const buildCoreDependencies = (registry: HandlerRegistry) => ({
    handlerRegistry: registry,
    container: undefined,
    loggerFactory,
    messageSerializer,
    messageTypes,
    serializer,
    retryStrategy: retryStrategy.object,
    interruptSignals: []
  })

  beforeEach(async () => {
    logger = Mock.ofType<Logger>()
    loggerFactory = () => logger.object

    sut = new InMemoryQueue({
      maxRetries: 3,
      receiveTimeoutMs: 1000
    })
    sut.prepare(buildCoreDependencies(handlerRegistry))

    handlerRegistry.register(TestEvent, () => undefined)
    handlerRegistry.register(TestCommand, () => undefined)
    handlerRegistry.register(TestEvent2, () => undefined)

    await sut.initialize()
  })

  describe('when publishing an event', () => {
    it('should push the event onto the memory queue', async () => {
      await sut.publish(event, messageOptions)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when sending a command', () => {
    it('should push the command onto the memory queue', async () => {
      await sut.send(command, messageOptions)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when sending a message that is not handled', () => {
    beforeEach(async () => {
      await sut.send(command2, messageOptions)
    })

    it('should not push the message onto the queue', () => {
      expect(sut.depth).toEqual(0)
    })

    it('should log the discard at debug level rather than warn', () => {
      logger.verify(
        l =>
          l.debug(
            'Message was not sent as it has no registered handlers',
            It.isAny()
          ),
        Times.once()
      )
      logger.verify(l => l.warn(It.isAny(), It.isAny()), Times.never())
    })
  })

  describe('when reading the next message', () => {
    it('should return undefined when the queue is empty', async () => {
      const message = await sut.readNextMessage()
      expect(message).toBeUndefined()
    })

    it('should return the message when the queue has one', async () => {
      await sut.publish(event, messageOptions)
      const message = await sut.readNextMessage()
      expect(message!.domainMessage).toEqual(event)
    })

    it('should read new messages with seenCount equal to 1', async () => {
      await sut.publish(event, messageOptions)
      const message = await sut.readNextMessage()
      expect(message!.raw.seenCount).toEqual(0)
    })

    it('should return the oldest message when there are many', async () => {
      await sut.publish(event, messageOptions)
      await sut.send(command)

      const firstMessage = await sut.readNextMessage()
      expect(firstMessage!.domainMessage).toEqual(event)

      const secondMessage = await sut.readNextMessage()
      expect(secondMessage!.domainMessage).toEqual(command)
    })

    it('should retain the queue depth while the message is unacknowledged', async () => {
      await sut.publish(event, messageOptions)
      expect(sut.depth).toEqual(1)

      const message = await sut.readNextMessage()
      expect(sut.depth).toEqual(1)

      await sut.deleteMessage(message!)
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when returning a message back onto the queue', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    const retryDelay = 5
    beforeEach(async () => {
      retryStrategy.reset()

      retryStrategy
        .setup(r => r.calculateRetryDelay(0))
        .returns(() => retryDelay)
        .verifiable(Times.once())
      await sut.publish(event, messageOptions)
      message = await sut.readNextMessage()
    })

    it('should toggle the inFlight flag to true when read', () => {
      expect(message).toBeDefined()
      expect(message!.raw.inFlight).toEqual(true)
    })

    it('should toggle the inFlight flag to false', async () => {
      await sut.returnMessage(message!)
      await sleep(retryDelay)
      expect(message!.raw.inFlight).toEqual(false)
    })

    it('should increment the seenCount', async () => {
      await sut.returnMessage(message!)
      expect(message!.raw.seenCount).toEqual(1)
    })

    it('should delay retrying the message based on the retry strategy', async () => {
      await sut.returnMessage(message!)
      retryStrategy.verifyAll()
    })
  })

  describe('when retrying a message has been retried beyond the retry limit', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    beforeEach(async () => {
      retryStrategy.reset()
      retryStrategy
        .setup(r => r.calculateRetryDelay(It.isAny()))
        .returns(() => 0)
      await sut.publish(event, messageOptions)

      let attempt = 0
      while (attempt < 3) {
        // Retry to the limit
        message = await sut.readNextMessage()
        if (!message) {
          continue
        }
        await sut.returnMessage(message!)
        attempt++
      }
    })

    it('should send the message to the dead letter queue', () => {
      expect(sut.deadLetterQueueDepth).toEqual(1)
    })
  })

  describe('when failing a message', () => {
    const message = new TestEvent2()

    beforeEach(async () => {
      await sut.publish(message)
      const receivedMessage = await sut.readNextMessage()
      await sut.fail(receivedMessage!)
    })

    it('should forward it to the dead letter queue', () => {
      expect(sut.deadLetterQueueDepth).toEqual(1)
    })

    it('should only fail the handled message', async () => {
      const emitter = new EventEmitter()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withConcurrency(1)
        .withHandler(
          handlerFor(TestEvent, async () => {
            await bus.send(new TestCommand())
            await bus.failMessage()
          })
        )
        .withHandler(
          handlerFor(TestCommand, () => {
            emitter.emit('done')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      const completion = new Promise<void>(resolve =>
        emitter.once('done', resolve)
      )
      await bus.publish(new TestEvent())
      await completion
      await bus.dispose()
    })
  })

  describe('when a message is published while waiting for a read', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    let elapsedMs: number

    beforeEach(async () => {
      const startedAt = Date.now()
      const read = sut.readNextMessage()
      await sut.publish(event, messageOptions)
      message = await read
      elapsedMs = Date.now() - startedAt
    })

    it('should return the message without waiting for the receive timeout', () => {
      expect(message!.domainMessage).toEqual(event)
      expect(elapsedMs).toBeLessThan(500)
    })
  })

  describe('when many reads are waiting and one message is published', () => {
    let messages: (TransportMessage<InMemoryMessage> | undefined)[]

    beforeEach(async () => {
      const reads = [sut.readNextMessage(), sut.readNextMessage()]
      await sut.publish(event, messageOptions)
      messages = await Promise.all(reads)
    })

    it('should only return the message to one reader', () => {
      expect(messages.filter(m => !!m)).toHaveLength(1)
    })
  })

  describe('when a returned message becomes visible while waiting for a read', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    let elapsedMs: number

    beforeEach(async () => {
      retryStrategy.reset()
      retryStrategy
        .setup(r => r.calculateRetryDelay(It.isAny()))
        .returns(() => 10)
      await sut.publish(event, messageOptions)
      const firstRead = await sut.readNextMessage()
      await sut.returnMessage(firstRead!)

      const startedAt = Date.now()
      message = await sut.readNextMessage()
      elapsedMs = Date.now() - startedAt
    })

    it('should return the message without waiting for the receive timeout', () => {
      expect(message!.domainMessage).toEqual(event)
      expect(elapsedMs).toBeLessThan(500)
    })
  })

  describe('when disposing', () => {
    describe('with a read waiting', () => {
      let message: TransportMessage<InMemoryMessage> | undefined
      let elapsedMs: number

      beforeEach(async () => {
        const startedAt = Date.now()
        const read = sut.readNextMessage()
        await sut.dispose()
        message = await read
        elapsedMs = Date.now() - startedAt
      })

      it('should resolve the read with no message', () => {
        expect(message).toBeUndefined()
        expect(elapsedMs).toBeLessThan(500)
      })
    })

    describe('with a message waiting to be retried', () => {
      let message: TransportMessage<InMemoryMessage> | undefined
      const retryDelay = 20

      beforeEach(async () => {
        retryStrategy.reset()
        retryStrategy
          .setup(r => r.calculateRetryDelay(It.isAny()))
          .returns(() => retryDelay)
        await sut.publish(event, messageOptions)
        message = await sut.readNextMessage()
        await sut.returnMessage(message!)
        await sut.dispose()
        await sleep(retryDelay * 2)
      })

      it('should cancel the retry', () => {
        expect(message!.raw.inFlight).toEqual(true)
      })
    })
  })

  describe('when sending before initialization', () => {
    let sendError: unknown

    beforeEach(async () => {
      sut = new InMemoryQueue()
      sut.prepare(buildCoreDependencies(handlerRegistry))
      try {
        await sut.send(command, messageOptions)
      } catch (error) {
        sendError = error
      }
    })

    it('should not throw', () => {
      expect(sendError).toBeUndefined()
    })

    it('should discard the message', () => {
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when a send-only bus without handlers sends a message', () => {
    let sendError: unknown

    beforeEach(async () => {
      sut = new InMemoryQueue()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .asSendOnly()
        .build()
      await bus.initialize()
      try {
        await bus.send(command2)
      } catch (error) {
        sendError = error
      }
      await bus.dispose()
    })

    it('should not throw', () => {
      expect(sendError).toBeUndefined()
    })

    it('should discard the message', () => {
      expect(sut.depth).toEqual(0)
    })
  })
})
