import { messageAttributes } from '@node-ts/bus-messages'
import {
  TestCommand,
  TestCommand2,
  TestCommandContextClassHandler,
  testCommandContextHandler,
  TestEvent
} from '../test'
import { handlerContext } from './recording-handler-context'

describe('handlerContext', () => {
  describe('when a function handler is called with it', () => {
    const sut = handlerContext({ correlationId: 'correlation-1' })

    beforeAll(async () => {
      await testCommandContextHandler.messageHandler(
        new TestCommand(),
        messageAttributes(),
        sut
      )
    })

    it('should record what it published, with no options', () => {
      expect(sut.published).toEqual([
        { message: new TestEvent('correlation-1'), options: {} }
      ])
    })

    it('should record nothing else', () => {
      expect(sut.sent).toEqual([])
      expect(sut.replied).toEqual([])
      expect(sut.messageFailed).toEqual(false)
      expect(sut.messageReturned).toEqual(false)
    })
  })

  describe('when a class handler is called with it', () => {
    const sut = handlerContext()

    beforeAll(async () => {
      await new TestCommandContextClassHandler().handle(
        new TestCommand2(),
        messageAttributes(),
        sut
      )
    })

    it('should record what it published', () => {
      expect(sut.published).toEqual([
        { message: new TestEvent('from-class-handler'), options: {} }
      ])
    })
  })

  describe('when sending, publishing and replying with options', () => {
    const sut = handlerContext()
    const deliverAt = new Date('2030-01-01T00:00:00Z')

    beforeAll(async () => {
      await sut.send(new TestCommand(), { deliverAfter: 30_000 })
      await sut.publish(new TestEvent('b'), {
        deliverAt,
        attributes: { tenantId: 't' }
      })
      await sut.reply(new TestEvent('c'), { correlationId: 'reply' })
    })

    it('should record each with its options', () => {
      expect(sut.sent).toEqual([
        { message: new TestCommand(), options: { deliverAfter: 30_000 } }
      ])
      expect(sut.published).toEqual([
        {
          message: new TestEvent('b'),
          options: { deliverAt, attributes: { tenantId: 't' } }
        }
      ])
      expect(sut.replied).toEqual([
        { message: new TestEvent('c'), options: { correlationId: 'reply' } }
      ])
    })
  })

  describe('when failing and returning the message', () => {
    const sut = handlerContext()

    beforeAll(async () => {
      await sut.failMessage()
      await sut.returnMessage()
    })

    it('should record both', () => {
      expect(sut.messageFailed).toEqual(true)
      expect(sut.messageReturned).toEqual(true)
    })
  })

  describe('when created without overrides', () => {
    const sut = handlerContext()

    it('should have no correlation id', () => {
      expect(sut.correlationId).toBeUndefined()
    })
  })

  describe('when a function is overridden', () => {
    const replies: string[] = []
    const sut = handlerContext({
      reply: async () => {
        replies.push('replied')
      }
    })

    beforeAll(async () => {
      await sut.reply(new TestEvent())
    })

    it('should call the override instead of recording', () => {
      expect(replies).toEqual(['replied'])
      expect(sut.replied).toEqual([])
    })
  })
})
