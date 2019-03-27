import { MemoryQueue } from './memory-queue'
import { TestEvent } from '../test/test-event'
import { TestCommand } from '../test/test-command'

const event = new TestEvent()
const command = new TestCommand()

describe('MemoryQueue', () => {
  let sut: MemoryQueue

  beforeEach(() => {
    sut = new MemoryQueue()
  })

  describe('when publishing an event', () => {
    it('should push the event onto the memory queue', async () => {
      await sut.publish(event)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when sending a command', () => {
    it('should push the command onto the memory queue', async () => {
      await sut.send(command)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when reading the next message', () => {
    it('should return undefined when the queue is empty', async () => {
      const message = await sut.readNextMessage()
      expect(message).toBeUndefined()
    })

    it('should return the message when the queue has one', async () => {
      await sut.publish(event)
      const message = await sut.readNextMessage()
      expect(message).toEqual(event)
    })

    it('should return the oldest message when there are many', async () => {
      await sut.publish(event)
      await sut.send(command)

      const firstMessage = await sut.readNextMessage()
      expect(firstMessage).toEqual(event)

      const secondMessage = await sut.readNextMessage()
      expect(secondMessage).toEqual(command)
    })
  })

  describe('when returning a message back onto the queue', () => {
    it('should insert it at the start', async () => {
      await sut.publish(event)
      await sut.returnMessage(command)
      expect(sut.depth).toEqual(2)
      const firstMessage = await sut.readNextMessage()
      expect(firstMessage).toEqual(command)
    })
  })
})
