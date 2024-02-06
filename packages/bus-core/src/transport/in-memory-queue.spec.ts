import { InMemoryQueue, InMemoryMessage } from './in-memory-queue'
import { TestCommand, TestEvent, TestCommand2, TestEvent2 } from '../test'
import { TransportMessage } from '.'
import { MessageAttributes } from '@node-ts/bus-messages'
import * as faker from 'faker'
import { IMock, It, Mock, Times } from 'typemoq'
import { Logger, LoggerFactory } from '../logger'
import { DefaultHandlerRegistry, handlerFor, HandlerRegistry } from '../handler'
import { JsonSerializer, MessageSerializer } from '../serialization'
import EventEmitter from 'events'
import { Bus } from '../service-bus/bus'
import { RetryStrategy } from '../retry-strategy'
import { sleep } from '../../dist'

const event = new TestEvent()
const command = new TestCommand()
const command2 = new TestCommand2()

describe('InMemoryQueue', () => {
  let sut: InMemoryQueue
  const messageOptions: MessageAttributes = {
    correlationId: faker.random.uuid(),
    attributes: {},
    stickyAttributes: {}
  }

  const handlerRegistry: HandlerRegistry = new DefaultHandlerRegistry()
  let logger: IMock<Logger>
  let loggerFactory: LoggerFactory

  const serializer = new JsonSerializer()
  const messageSerializer = new MessageSerializer(serializer, handlerRegistry)

  const retryStrategy = Mock.ofType<RetryStrategy>()

  beforeEach(async () => {
    logger = Mock.ofType<Logger>()
    loggerFactory = () => logger.object

    sut = new InMemoryQueue({
      maxRetries: 3,
      receiveTimeoutMs: 1000
    })
    sut.prepare({
      handlerRegistry,
      container: undefined,
      loggerFactory,
      messageSerializer,
      serializer,
      retryStrategy: retryStrategy.object,
      interruptSignals: []
    })

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
    it('should not push the message onto the queue', async () => {
      await sut.send(command2, messageOptions)
      expect(sut.depth).toEqual(0)
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
        .withConcurrency(1)
        .withHandler(
          handlerFor(TestEvent, async () => {
            await bus.send(new TestCommand())
            await bus.fail()
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
})
