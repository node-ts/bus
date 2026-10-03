import { Milliseconds } from '../util'

/**
 * What to do with a message that failed, as decided by a `RecoverabilityPolicy`. Build one with `retry()` or
 * `deadLetter()`.
 */
export type RecoverabilityAction =
  | {
      readonly action: 'retry'
      /**
       * How long the message waits in the queue before it's handled again
       */
      readonly delay: Milliseconds
    }
  | { readonly action: 'deadLetter' }

/**
 * The longest retry delay, which is the longest timer Node.js supports (about 24.8 days)
 */
export const MAX_RETRY_DELAY: Milliseconds = 2 ** 31 - 1

/**
 * Returns the failed message to the queue, to be handled again after `delay`. The retry always goes back through
 * the queue, even with a delay of 0, so other messages can be handled in the meantime.
 * @param delay how long to wait before handling the message again, in milliseconds. A negative delay or `NaN` is
 * treated as 0, and a delay above `MAX_RETRY_DELAY`, including `Infinity`, as `MAX_RETRY_DELAY`. Transports round it
 * to what they support: SQS to whole seconds, up to 12 hours.
 * @returns the action for a `RecoverabilityPolicy` to return
 * @example
 * const policy: RecoverabilityPolicy = ({ failedAttempts }) =>
 *   failedAttempts < 3 ? retry(1_000) : deadLetter()
 */
export const retry = (delay: Milliseconds): RecoverabilityAction => ({
  action: 'retry',
  delay: Number.isNaN(delay) ? 0 : Math.min(Math.max(0, delay), MAX_RETRY_DELAY)
})

/**
 * Moves the failed message to the dead letter queue with its failure metadata, without retrying it
 * @returns the action for a `RecoverabilityPolicy` to return
 * @example
 * const policy: RecoverabilityPolicy = ({ failedAttempts }) =>
 *   failedAttempts < 3 ? retry(1_000) : deadLetter()
 */
export const deadLetter = (): RecoverabilityAction => ({ action: 'deadLetter' })

/**
 * Checks that a policy returned an action the bus can carry out: `deadLetter()`, or `retry()` with a finite delay of
 * 0 or more
 * @param action what the policy returned
 * @returns true if the bus can carry it out
 */
export const isRecoverabilityAction = (
  action: unknown
): action is RecoverabilityAction => {
  if (typeof action !== 'object' || action === null) {
    return false
  }
  const { action: kind, delay } = action as {
    action?: unknown
    delay?: unknown
  }
  return (
    kind === 'deadLetter' ||
    (kind === 'retry' &&
      typeof delay === 'number' &&
      Number.isFinite(delay) &&
      delay >= 0)
  )
}
