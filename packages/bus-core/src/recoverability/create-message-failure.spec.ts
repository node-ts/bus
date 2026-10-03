import { HandlerDispatchRejected } from '../handler/error'
import { createMessageFailure } from './create-message-failure'
import { FailMessageRequested } from './error'
import { MessageFailure } from './message-failure'

const details = {
  failedAttempts: 3,
  endpoint: 'orders',
  messageId: 'message-id'
}

describe('createMessageFailure', () => {
  describe('when the error is a built-in error', () => {
    let sut: MessageFailure

    beforeAll(() => {
      sut = createMessageFailure(new TypeError('Bad type'), details)
    })

    it('should describe the error', () => {
      expect(sut.error).toMatchObject({
        name: 'TypeError',
        message: 'Bad type'
      })
      expect(sut.error.stack).toContain('Bad type')
    })

    it('should include the attempts, endpoint and messageId', () => {
      expect(sut).toMatchObject(details)
    })

    it('should set failedAt to now', () => {
      expect(Date.now() - new Date(sut.failedAt).getTime()).toBeLessThan(1_000)
    })
  })

  describe('when the error is one of the bus errors, which leave name as Error', () => {
    it('should name it by its class', () => {
      const sut = createMessageFailure(new FailMessageRequested('m'), details)
      expect(sut.error.name).toEqual('FailMessageRequested')
    })
  })

  describe('when one handler failed', () => {
    it('should describe that handler error', () => {
      const sut = createMessageFailure(
        new HandlerDispatchRejected([new RangeError('Out of range')]),
        details
      )
      expect(sut.error).toMatchObject({
        name: 'RangeError',
        message: 'Out of range'
      })
    })
  })

  describe('when several handlers failed', () => {
    it('should describe the rejection, which lists every error', () => {
      const sut = createMessageFailure(
        new HandlerDispatchRejected([new Error('First'), new Error('Second')]),
        details
      )
      expect(sut.error.name).toEqual('HandlerDispatchRejected')
      expect(sut.error.message).toContain('First')
      expect(sut.error.message).toContain('Second')
    })
  })

  describe('when the error message and stack are long', () => {
    it('should truncate them', () => {
      const error = new Error('m'.repeat(5_000))
      error.stack = 's'.repeat(10_000)
      const sut = createMessageFailure(error, details)
      expect(sut.error.message).toHaveLength(1_000)
      expect(sut.error.stack).toHaveLength(4_000)
    })
  })

  describe('when something other than an error was thrown', () => {
    it('should describe it as a NonError', () => {
      const sut = createMessageFailure('failed', details)
      expect(sut.error).toEqual({ name: 'NonError', message: 'failed' })
    })
  })
})
