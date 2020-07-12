import { MemoryQueue, InMemoryMessage, RETRY_LIMIT, toTransportMessage, RECEIVE_TIMEOUT_MS } from './memory-queue'
import { TestCommand, TestEvent, TestCommand2, TestSystemMessage, TestFailMessage } from '../test'
import { TransportMessage } from '../transport'
import { Mock } from 'typemoq'
import { Logger } from '@node-ts/logger-core'
import { HandlerRegistry, HandlerResolver } from '../handler'
import { MessageAttributes } from '@node-ts/bus-messages'
import * as faker from 'faker'

const event = new TestEvent()
const command = new TestCommand()
const command2 = new TestCommand2()

describe('MemoryQueue', () => {
  let sut: MemoryQueue
  const handledMessages = [TestCommand, TestEvent]
  const messageOptions = new MessageAttributes({
    correlationId: faker.random.uuid()
   })

  beforeEach(async () => {
    const handlerRegistry = Mock.ofType<HandlerRegistry>()
    handlerRegistry
      .setup(h => h.messageSubscriptions)
      .returns(() => handledMessages.map(h => ({ messageType: h }) as {} as HandlerResolver))

    sut = new MemoryQueue(
      Mock.ofType<Logger>().object,
      handlerRegistry.object
    )

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

  describe('when sending a system message', () => {
    it('should push the message onto the queue', async () => {
      sut.addToQueue(new TestSystemMessage())
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when failing a message', () => {
    beforeEach(async () => {
      const message = new TestFailMessage(faker.random.uuid())
      const transportMessage = toTransportMessage(message, new MessageAttributes(), true)
      await sut.fail(transportMessage)
    })

    it('should deliver the failed message to the dead letter queue', () => {
      expect(sut.deadLetterQueueDepth).toEqual(1)
    })

    it('should remove the message from the source queue', () => {
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when reading the next message', () => {
    it('should return undefined when the queue is empty', async () => {
      jest.useFakeTimers()
      const readNextMessagePromise = sut.readNextMessage()
      jest.advanceTimersByTime(RECEIVE_TIMEOUT_MS)
      const message = await readNextMessagePromise
      expect(message).toBeUndefined()
    })

    it('should return when a message is published', async () => {
      jest.useFakeTimers()
      const readNextMessagPromise = sut.readNextMessage()
      jest.advanceTimersByTime(RECEIVE_TIMEOUT_MS / 2)
      await sut.publish(event, messageOptions)
      const message = await readNextMessagPromise
      expect(message).toBeDefined()
    })

    it('should return a single message from the emitter', async () => {
      jest.useFakeTimers()
      const readNextMessagePromise = sut.readNextMessage()
      jest.advanceTimersByTime(RECEIVE_TIMEOUT_MS / 2)
      await sut.publish({...event}, messageOptions)
      await sut.publish({...event}, messageOptions)
      const message = await readNextMessagePromise
      expect(message).toBeDefined()
      await sut.deleteMessage(message!)
      expect(sut.depth).toEqual(1)
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
})
