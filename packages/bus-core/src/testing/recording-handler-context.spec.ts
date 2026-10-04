import { messageAttributes } from '@node-ts/bus-messages'
import { DelayedReplyNotSupported, ReturnAddressMissing } from '../error'
import { InvalidDeliveryOptions, SendOptions } from '../outgoing-message'
import {
  TestCommand,
  TestCommand2,
  TestCommandContextClassHandler,
  testCommandContextHandler,
  TestEvent
} from '../test'
import {
  handlerContext,
  RecordingHandlerContext
} from './recording-handler-context'
import { TEST_RETURN_ADDRESS } from './test-return-address'

describe('handlerContext', () => {
  describe('when a function handler is called with it', () => {
    let sut: RecordingHandlerContext

    beforeAll(async () => {
      sut = handlerContext({ correlationId: 'correlation-1' })
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

    it('should narrow what it published by type', () => {
      expect(sut.publishedOf(TestEvent)[0].message.property1).toEqual(
        'correlation-1'
      )
      expect(sut.sentOf(TestCommand)).toEqual([])
    })

    it('should record nothing else', () => {
      expect(sut.sent).toEqual([])
      expect(sut.replied).toEqual([])
      expect(sut.messageFailed).toEqual(false)
      expect(sut.messageReturned).toEqual(false)
    })
  })

  describe('when a class handler is called with it', () => {
    let sut: RecordingHandlerContext

    beforeAll(async () => {
      sut = handlerContext()
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
    const deliverAt = new Date('2030-01-01T00:00:00Z')
    let sut: RecordingHandlerContext

    beforeAll(async () => {
      sut = handlerContext()
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
    })

    it('should record the reply to the test return address', () => {
      expect(sut.replied).toEqual([
        {
          message: new TestEvent('c'),
          options: { correlationId: 'reply' },
          destination: TEST_RETURN_ADDRESS
        }
      ])
    })
  })

  describe.each([
    ['a deliverAfter that is not a number', { deliverAfter: NaN }],
    ['a negative deliverAfter', { deliverAfter: -1 }],
    ['an invalid deliverAt', { deliverAt: new Date('not a date') }],
    [
      'both deliverAfter and deliverAt',
      { deliverAfter: 1, deliverAt: new Date() } as unknown as SendOptions
    ]
  ] as [string, SendOptions][])('when sending with %s', (_, options) => {
    let sut: RecordingHandlerContext
    let sendError: unknown
    let publishError: unknown

    beforeAll(async () => {
      sut = handlerContext()
      sendError = await sut
        .send(new TestCommand(), options)
        .catch((e: unknown) => e)
      publishError = await sut
        .publish(new TestEvent(), options)
        .catch((e: unknown) => e)
    })

    it('should throw InvalidDeliveryOptions, as the bus does', () => {
      expect(sendError).toBeInstanceOf(InvalidDeliveryOptions)
      expect(publishError).toBeInstanceOf(InvalidDeliveryOptions)
    })

    it('should record nothing', () => {
      expect(sut.sent).toEqual([])
      expect(sut.published).toEqual([])
    })
  })

  describe('when replying with delivery options', () => {
    let sut: RecordingHandlerContext
    let error: unknown

    beforeAll(async () => {
      sut = handlerContext()
      // reply() doesn't type them, but a caller may pass the options it gives send()
      error = await sut
        .reply(new TestEvent(), { deliverAfter: 1 } as {})
        .catch((e: unknown) => e)
    })

    it('should throw DelayedReplyNotSupported', () => {
      expect(error).toBeInstanceOf(DelayedReplyNotSupported)
      expect(sut.replied).toEqual([])
    })
  })

  describe('when replying', () => {
    describe('with a return address', () => {
      let sut: RecordingHandlerContext

      beforeAll(async () => {
        sut = handlerContext({ replyTo: 'requester' })
        await sut.reply(new TestEvent())
      })

      it('should record the reply to it', () => {
        expect(sut.replied[0].destination).toEqual('requester')
      })
    })

    describe('without a return address', () => {
      let error: unknown

      beforeAll(async () => {
        error = await handlerContext({ replyTo: undefined })
          .reply(new TestEvent())
          .catch((e: unknown) => e)
      })

      it('should throw ReturnAddressMissing', () => {
        expect(error).toBeInstanceOf(ReturnAddressMissing)
      })
    })
  })

  describe('when failing and returning the message', () => {
    let sut: RecordingHandlerContext

    beforeAll(async () => {
      sut = handlerContext()
      await sut.failMessage()
      await sut.returnMessage()
    })

    it('should record both', () => {
      expect(sut.messageFailed).toEqual(true)
      expect(sut.messageReturned).toEqual(true)
    })
  })

  describe('when created without overrides', () => {
    let sut: RecordingHandlerContext

    beforeAll(() => {
      sut = handlerContext()
    })

    it('should have no correlation id', () => {
      expect(sut.correlationId).toBeUndefined()
    })
  })

  describe('when a function is overridden', () => {
    const replies: string[] = []
    let sut: RecordingHandlerContext

    beforeAll(async () => {
      sut = handlerContext({
        reply: async () => {
          replies.push('replied')
        }
      })
      await sut.reply(new TestEvent())
    })

    it('should call the override instead of recording', () => {
      expect(replies).toEqual(['replied'])
      expect(sut.replied).toEqual([])
    })
  })
})
