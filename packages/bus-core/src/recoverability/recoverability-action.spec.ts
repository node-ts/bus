import {
  deadLetter,
  isRecoverabilityAction,
  MAX_RETRY_DELAY,
  retry
} from './recoverability-action'

describe('retry', () => {
  describe.each([
    [1_000, 1_000],
    [0, 0],
    [-5, 0],
    [NaN, 0],
    [Infinity, MAX_RETRY_DELAY],
    [MAX_RETRY_DELAY + 1, MAX_RETRY_DELAY]
  ])('when given a delay of %s', (delay, expected) => {
    it(`should retry after ${expected}ms`, () => {
      expect(retry(delay)).toEqual({ action: 'retry', delay: expected })
    })
  })
})

describe('isRecoverabilityAction', () => {
  describe.each([
    ['deadLetter()', deadLetter()],
    ['retry(0)', retry(0)],
    ['retry(1000)', retry(1_000)]
  ])('when given %s', (_, action) => {
    it('should be true', () => {
      expect(isRecoverabilityAction(action)).toEqual(true)
    })
  })

  describe.each([
    ['undefined', undefined],
    ['null', null],
    ['a promise', Promise.resolve(deadLetter())],
    ['a retry with a NaN delay', { action: 'retry', delay: NaN }],
    ['a retry with a negative delay', { action: 'retry', delay: -1 }],
    ['a retry with an infinite delay', { action: 'retry', delay: Infinity }],
    ['a retry without a delay', { action: 'retry' }],
    ['an unknown action', { action: 'ignore' }]
  ])('when given %s', (_, action) => {
    it('should be false', () => {
      expect(isRecoverabilityAction(action)).toEqual(false)
    })
  })
})
