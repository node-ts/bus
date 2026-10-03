import { exponentialBackoff } from './exponential-backoff'

describe('exponentialBackoff', () => {
  describe('without options', () => {
    const sut = exponentialBackoff()

    it.each([
      [1, 5, 6],
      [2, 23, 28],
      [3, 113, 138],
      [4, 563, 688],
      [5, 2813, 3438],
      [6, 14063, 17188],
      [7, 70313, 85938],
      [8, 351563, 429688],
      [9, 1757813, 2148438],
      [10, 8789063, 9000000],
      [20, 9000000, 9000000]
    ])(
      'failure %s should delay between %sms and %sms',
      (failedAttempts, minDelay, maxDelay) => {
        const delay = sut(failedAttempts)
        expect(delay).toBeGreaterThanOrEqual(minDelay)
        expect(delay).toBeLessThanOrEqual(maxDelay)
      }
    )
  })

  describe('with options and no jitter', () => {
    const sut = exponentialBackoff({
      initialDelay: 100,
      factor: 2,
      maxDelay: 1_000,
      jitter: 0
    })

    it('should start at the initial delay and multiply it by the factor up to the max delay', () => {
      expect([1, 2, 3, 4, 5].map(sut)).toEqual([100, 200, 400, 800, 1_000])
    })
  })
})
