import { MemoryQueue, InMemoryMessage, RETRY_LIMIT } from './memory-queue'
import { TestCommand, TestEvent, TestCommand2, TestEvent2 } from '../test'
import { TransportMessage } from '../transport'
import { MessageAttributes } from '@node-ts/bus-messages'
import * as faker from 'faker'
import { IMock, Mock } from 'typemoq'
import { Logger, LoggerFactory } from '../logger'
import { DefaultHandlerRegistry, handlerFor, HandlerRegistry } from '../handler'
import { JsonSerializer, MessageSerializer } from '../serialization'
import EventEmitter from 'events'
import { Bus } from '../service-bus/bus'

const event = new TestEvent()
const command = new TestCommand()
const command2 = new TestCommand2()

describe('MemoryQueue', () => {
  let sut: MemoryQueue
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

  beforeEach(async () => {
    logger = Mock.ofType<Logger>()
    loggerFactory = () => logger.object

    sut = new MemoryQueue()
    sut.prepare({
      handlerRegistry,
      container: undefined,
      loggerFactory,
      messageSerializer,
      serializer
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
    beforeEach(async () => {
      await sut.publish(event, messageOptions)
      message = await sut.readNextMessage()
    })

    it('should toggle the inFlight flag to true when read', () => {
      expect(message).toBeDefined()
      expect(message!.raw.inFlight).toEqual(true)
    })

    it('should toggle the inFlight flag to false', async () => {
      await sut.returnMessage(message!)
      expect(message!.raw.inFlight).toEqual(false)
    })

    it('should increment the seenCount', async () => {
      await sut.returnMessage(message!)
      expect(message!.raw.seenCount).toEqual(1)
    })
  })

  describe('when retrying a message has been retried beyond the retry limit', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    beforeEach(async () => {
      await sut.publish(event, messageOptions)

      let attempt = 0
      while (attempt < RETRY_LIMIT) {
        // Retry to the limit
        message = await sut.readNextMessage()
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
      const bus = await Bus.configure()
        .withConcurrency(1)
        .withHandler(handlerFor(TestEvent, async () => {
          await bus.send(new TestCommand())
          await bus.fail()
        }))
        .withHandler(handlerFor(TestCommand, () => { emitter.emit('done') }))
        .initialize()

      await bus.start()

      const completion = new Promise<void>(resolve => emitter.once('done', resolve))
      await bus.publish(new TestEvent())
      await completion
      await bus.dispose()
    })
  })
})
