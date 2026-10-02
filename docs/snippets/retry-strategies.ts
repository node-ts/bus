import {
  Bus,
  DefaultRetryStrategy,
  Milliseconds,
  RetryStrategy
} from '@node-ts/bus-core'

// #region configure
Bus.configure().withRetryStrategy(new DefaultRetryStrategy())
// #endregion configure

// #region custom
const MAX_DELAY_MS: Milliseconds = 60_000

/**
 * Waits one more second for each failed attempt, up to a minute
 */
export class LinearRetryStrategy implements RetryStrategy {
  calculateRetryDelay(currentAttempt: number): Milliseconds {
    return Math.min((currentAttempt + 1) * 1_000, MAX_DELAY_MS)
  }
}

Bus.configure().withRetryStrategy(new LinearRetryStrategy())
// #endregion custom
