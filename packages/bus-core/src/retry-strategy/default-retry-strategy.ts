import { Milliseconds, RetryStrategy } from './retry-strategy'

const MAX_DELAY_MS = 2.5 * 60 * 60 * 1000 // 2.5 hours
const JITTER_PERCENT = 0.1

/**
 * A default message retry strategy that exponentially increases the delay between retries
 * from 5ms to 2.5 hrs for the first 10 attempts. Each retry delay includes a jitter of
 * up to 10% to avoid deadlock-related errors from continually blocking.
 */
export class DefaultRetryStrategy implements RetryStrategy {
  calculateRetryDelay(currentAttempt: number): Milliseconds {
    const numberOfFailures = currentAttempt + 1
    const constantDelay: Milliseconds = Math.pow(5, numberOfFailures)
    const jitterAmount = Math.random() * JITTER_PERCENT * constantDelay
    const jitterDirection = Math.random() > 0.5 ? 1 : -1
    const jitter = jitterAmount * jitterDirection
    const delay = Math.round(constantDelay + jitter)
    return Math.min(delay, MAX_DELAY_MS)
  }
}
