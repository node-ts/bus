import { MemoryQueue, InMemoryMessage } from './memory-queue'
import { TestEvent } from '../test/test-event'
import { TestCommand } from '../test/test-command'
import { TransportMessage } from '../../dist';

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
      expect(message!.domainMessage).toEqual(event)
    })

    it('should return the oldest message when there are many', async () => {
      await sut.publish(event)
      await sut.send(command)

      const firstMessage = await sut.readNextMessage()
      expect(firstMessage!.domainMessage).toEqual(event)

      const secondMessage = await sut.readNextMessage()
      expect(secondMessage!.domainMessage).toEqual(command)
    })
  })

  describe('when returning a message back onto the queue', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    beforeEach(async () => {
      await sut.publish(event)
      message = await sut.readNextMessage()
    })

    it('should toggle the inProcessing flag to true when read', () => {
      expect(message).toBeDefined()
      expect(message!.raw.isProcessing).toEqual(true)
    })

    it('should toggle the inProcessing flag to false', async () => {
      await sut.returnMessage(message!)
      expect(message!.raw.isProcessing).toEqual(false)
    })
  })
})
