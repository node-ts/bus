import { MessageHandlingFailure } from './message-handling-failure'
import { RecoverabilityAction } from './recoverability-action'

/**
 * Decides what happens to a message each time handling it fails: retry it after a delay, or move it to the dead
 * letter queue. It's a plain function, so it can be unit tested by calling it. Set it with
 * `Bus.configure().withRecoverability()`; the default is `defaultRecoverability()`.
 *
 * It isn't called for messages failed with `failMessage()`, which always go to the dead letter queue. If it throws,
 * the error is logged and the message is dead-lettered, so nothing is lost or retried in a tight loop.
 * @example
 * // Retry quickly a few times, then dead-letter
 * const policy: RecoverabilityPolicy = ({ failedAttempts }) =>
 *   failedAttempts < 3 ? retry(500 * failedAttempts) : deadLetter()
 */
export type RecoverabilityPolicy = (
  failure: MessageHandlingFailure
) => RecoverabilityAction
