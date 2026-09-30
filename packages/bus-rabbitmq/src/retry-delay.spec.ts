import { MAX_RETRY_DELAY, toRetryDelay, toRetryQueueDelay } from './retry-delay'

describe('toRetryDelay', () => {
  it.each([
    [0, 0],
    [5, 5],
    [5.2, 6],
    [-10, 0],
    [NaN, 0],
    [Infinity, MAX_RETRY_DELAY],
    [MAX_RETRY_DELAY + 1, MAX_RETRY_DELAY]
  ])(
    'should turn a delay of %s into a TTL of %s',
    (delay: number, expected: number) => {
      expect(toRetryDelay(delay)).toEqual(expected)
    }
  )
})

describe('toRetryQueueDelay', () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 4],
    [1000, 1024],
    [1024, 1024],
    [1025, 2048],
    [MAX_RETRY_DELAY, 2 ** 32]
  ])(
    'should put a delay of %s in the %sms retry queue',
    (delay: number, expected: number) => {
      expect(toRetryQueueDelay(delay)).toEqual(expected)
    }
  )

  it('should never put a delay in a queue more than twice its size', () => {
    for (let delay = 2; delay < 100_000; delay += 37) {
      const queueDelay = toRetryQueueDelay(delay)
      expect(queueDelay).toBeGreaterThanOrEqual(delay)
      expect(queueDelay).toBeLessThan(delay * 2)
    }
  })
})
