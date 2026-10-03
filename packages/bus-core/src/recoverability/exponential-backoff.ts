import { Milliseconds } from '../util'

/**
 * Options for `exponentialBackoff()`
 */
export interface ExponentialBackoffOptions {
  /**
   * The delay after the first failure. Each failure after that multiplies it by `factor`.
   * @default 5
   */
  initialDelay?: Milliseconds

  /**
   * What the delay is multiplied by after each failure
   * @default 5
   */
  factor?: number

  /**
   * The longest delay
   * @default 9_000_000 (2.5 hours)
   */
  maxDelay?: Milliseconds

  /**
   * How much each delay is randomly varied by, as a fraction of it, so that messages that failed together aren't
   * all retried at the same moment
   * @default 0.1
   */
  jitter?: number
}

/**
 * Works out how long to wait before retrying a message
 * @param failedAttempts how many times handling the message has failed, counting this failure, so `1` the first time
 * @returns the delay in milliseconds
 */
export type RetryDelay = (failedAttempts: number) => Milliseconds

const DEFAULT_INITIAL_DELAY: Milliseconds = 5
const DEFAULT_FACTOR = 5
const DEFAULT_MAX_DELAY: Milliseconds = 2.5 * 60 * 60 * 1000
const DEFAULT_JITTER = 0.1

/**
 * A retry delay that grows exponentially with each failure. With the defaults, the delays for the first 10
 * failures are about 5 ms, 25 ms, 125 ms, 625 ms, 3 s, 16 s, 78 s, 6.5 min, 33 min and 2.5 hours, each varied by up
 * to 10%.
 * @param options how the delay starts, grows and is capped
 * @returns the delay for `defaultRecoverability({ delay })`, or to call from your own policy
 * @example
 * defaultRecoverability({ delay: exponentialBackoff({ initialDelay: 1_000, factor: 2, maxDelay: 60_000 }) })
 */
export const exponentialBackoff = ({
  initialDelay = DEFAULT_INITIAL_DELAY,
  factor = DEFAULT_FACTOR,
  maxDelay = DEFAULT_MAX_DELAY,
  jitter = DEFAULT_JITTER
}: ExponentialBackoffOptions = {}): RetryDelay => {
  return failedAttempts => {
    const constantDelay =
      initialDelay * Math.pow(factor, Math.max(0, failedAttempts - 1))
    const variation = (Math.random() * 2 - 1) * jitter * constantDelay
    return Math.min(Math.round(constantDelay + variation), maxDelay)
  }
}
