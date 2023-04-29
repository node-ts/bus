import { DefaultRetryStrategy } from './default-retry-strategy'

describe('DefaultRetryStrategy', () => {
  const sut = new DefaultRetryStrategy()

  it.each([
    [0, 5, 6],
    [1, 23, 28],
    [2, 113, 138],
    [3, 563, 688],
    [4, 2813, 3438],
    [5, 14063, 17188],
    [6, 70313, 85938],
    [7, 351563, 429688],
    [8, 1757813, 2148438],
    [9, 8789063, 9000000]
  ])(
    'attempt %s should delay between %sms and %sms',
    (attempt: number, expectedMinDelay: number, expectedMaxDelay: number) => {
      const actualDelay = sut.calculateRetryDelay(attempt)
      expect(actualDelay).toBeGreaterThanOrEqual(expectedMinDelay)
      expect(actualDelay).toBeLessThanOrEqual(expectedMaxDelay)
    }
  )
})
