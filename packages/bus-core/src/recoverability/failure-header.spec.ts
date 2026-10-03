import { fromFailureHeader, toFailureHeader } from './failure-header'
import { MessageFailure } from './message-failure'

const failure: MessageFailure = {
  error: { name: 'Error', message: 'Failed', stack: 'Error: Failed' },
  failedAttempts: 2,
  endpoint: 'orders',
  messageId: 'message-id',
  failedAt: '2026-10-03T09:30:00.000Z'
}

describe('fromFailureHeader', () => {
  describe('when given a header written by toFailureHeader', () => {
    it('should read the failure back', () => {
      expect(fromFailureHeader(toFailureHeader(failure))).toEqual(failure)
    })
  })

  describe('when there is no header', () => {
    it('should return undefined', () => {
      expect(fromFailureHeader(undefined)).toBeUndefined()
    })
  })

  describe('when the header is not failure metadata', () => {
    it.each([['not json'], ['null'], ['{"error":"x"}'], [42]])(
      'should return undefined for %s',
      header => {
        expect(fromFailureHeader(header)).toBeUndefined()
      }
    )
  })
})
