import { sleep } from './sleep'

describe('sleep', () => {
  beforeEach(() => {
    jest.setTimeout(500)
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should sleep the duration of timeoutMs', async () => {
    const promise = sleep(1000)
    jest.advanceTimersByTime(1000)
    await promise
  })
})
