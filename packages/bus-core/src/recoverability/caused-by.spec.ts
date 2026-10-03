import { HandlerDispatchRejected } from '../handler/error'
import { causedBy } from './caused-by'

class ValidationError extends Error {}
class TimeoutError extends Error {}

describe('causedBy', () => {
  describe('when the error is one of the types', () => {
    it('should be true', () => {
      expect(causedBy(new ValidationError(), [ValidationError])).toEqual(true)
    })
  })

  describe('when the error is a subclass of one of the types', () => {
    it('should be true', () => {
      expect(causedBy(new ValidationError(), [Error])).toEqual(true)
    })
  })

  describe('when one of a handler dispatch rejection is one of the types', () => {
    it('should be true', () => {
      const error = new HandlerDispatchRejected([
        new TimeoutError(),
        new ValidationError()
      ])
      expect(causedBy(error, [ValidationError])).toEqual(true)
    })
  })

  describe('when the cause is one of the types', () => {
    it('should be true', () => {
      const error = new Error('Wrapped', { cause: new ValidationError() })
      expect(causedBy(error, [ValidationError])).toEqual(true)
    })
  })

  describe('when an error in an AggregateError is one of the types', () => {
    it('should be true', () => {
      const error = new AggregateError([new ValidationError()])
      expect(causedBy(error, [ValidationError])).toEqual(true)
    })
  })

  describe('when no error is one of the types', () => {
    it('should be false', () => {
      const error = new HandlerDispatchRejected([new TimeoutError()])
      expect(causedBy(error, [ValidationError])).toEqual(false)
    })
  })

  describe('when the thrown value is not an error', () => {
    it('should be false', () => {
      expect(causedBy('failed', [ValidationError])).toEqual(false)
    })
  })

  describe('when causes form a cycle', () => {
    it('should be false without overflowing the stack', () => {
      const error = new Error('Cyclic')
      ;(error as { cause?: unknown }).cause = error
      expect(causedBy(error, [ValidationError])).toEqual(false)
    })
  })
})
