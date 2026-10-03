import { HandlerAlreadyRegistered } from './handler-already-registered'
import { HandlerDispatchRejected } from './handler-dispatch-rejected'

describe('HandlerDispatchRejected', () => {
  describe('when one handler failed', () => {
    const rejection = new TypeError('orderId is undefined')
    let sut: HandlerDispatchRejected

    beforeAll(() => {
      sut = new HandlerDispatchRejected([rejection])
    })

    it('should put the handler error in the message', () => {
      expect(sut.message).toEqual(
        'Message handling failed in 1 handler, so the recoverability policy will retry or dead-letter the message: TypeError: orderId is undefined'
      )
    })

    it('should set the handler error as the cause', () => {
      expect(sut.cause).toBe(rejection)
    })
  })

  describe('when a handler failed with an error class that does not set its name', () => {
    let sut: HandlerDispatchRejected

    beforeAll(() => {
      sut = new HandlerDispatchRejected([
        new HandlerAlreadyRegistered('@node-ts/bus-core/test-command')
      ])
    })

    it('should label the error with its class', () => {
      expect(sut.message).toContain(': HandlerAlreadyRegistered: ')
    })
  })

  describe('when several handlers failed', () => {
    const rejections = [new Error('first'), 'second' as unknown as Error]
    let sut: HandlerDispatchRejected

    beforeAll(() => {
      sut = new HandlerDispatchRejected(rejections)
    })

    it('should list every handler error in the message', () => {
      expect(sut.message).toEqual(
        'Message handling failed in 2 handlers, so the recoverability policy will retry or dead-letter the message: Error: first; second'
      )
    })

    it('should set an AggregateError of them as the cause', () => {
      expect(sut.cause).toBeInstanceOf(AggregateError)
      expect((sut.cause as AggregateError).errors).toEqual(rejections)
    })

    it('should keep them in rejections', () => {
      expect(sut.rejections).toEqual(rejections)
    })
  })
})
