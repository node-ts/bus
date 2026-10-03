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
 * Returns the failed message to the queue, to be handled again after `delay`. The retry always goes back through
 * the queue, even with a delay of 0, so other messages can be handled in the meantime.
 * @param delay how long to wait before handling the message again, in milliseconds. Transports round it to what
 * they support: SQS to whole seconds, up to 12 hours.
 * @returns the action for a `RecoverabilityPolicy` to return
 * @example
 * const policy: RecoverabilityPolicy = ({ failedAttempts }) =>
 *   failedAttempts < 3 ? retry(1_000) : deadLetter()
 */
export const retry = (delay: Milliseconds): RecoverabilityAction => ({
  action: 'retry',
  delay: Math.max(0, delay)
})

/**
 * Moves the failed message to the dead letter queue with its failure metadata, without retrying it
 * @returns the action for a `RecoverabilityPolicy` to return
 * @example
 * const policy: RecoverabilityPolicy = ({ failedAttempts }) =>
 *   failedAttempts < 3 ? retry(1_000) : deadLetter()
 */
export const deadLetter = (): RecoverabilityAction => ({ action: 'deadLetter' })
