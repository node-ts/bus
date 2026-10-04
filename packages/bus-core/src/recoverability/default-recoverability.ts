import { DelayedReplyNotSupported, ReturnAddressMissing } from '../error'
import {
  EndpointNotFound,
  TransportReplyNotSupported
} from '../transport/error'
import { Milliseconds } from '../util'
import { causedBy, ErrorType } from './caused-by'
import { exponentialBackoff, RetryDelay } from './exponential-backoff'
import { deadLetter, retry } from './recoverability-action'
import { RecoverabilityPolicy } from './recoverability-policy'

/**
 * Options for `defaultRecoverability()`
 */
export interface DefaultRecoverabilityOptions {
  /**
   * How many times a message is handled before it's moved to the dead letter queue, counting the first attempt. `1`
   * never retries.
   * @default 10
   */
  maxAttempts?: number

  /**
   * How long to wait before each retry: a number of milliseconds, or a function of how many times the message has
   * failed so far
   * @default exponentialBackoff()
   */
  delay?: RetryDelay | Milliseconds

  /**
   * Errors that retrying can't fix, such as validation errors. A message that fails with one of these, found
   * anywhere in the error as `causedBy()` looks, goes to the dead letter queue on its first failure. They're added
   * to `ALWAYS_UNRECOVERABLE`, which are always dead-lettered straight away.
   * @default []
   */
  unrecoverable?: ErrorType[]
}

const DEFAULT_MAX_ATTEMPTS = 10

/**
 * Errors that `defaultRecoverability()` always dead-letters on the first failure, because handling the message
 * again can never succeed and would only repeat the handler's side effects: a delayed reply, a reply to a message
 * with no return address, a reply on a transport that can't send one, and a reply to a return address with no
 * queue.
 */
export const ALWAYS_UNRECOVERABLE: readonly ErrorType[] = [
  DelayedReplyNotSupported,
  ReturnAddressMissing,
  TransportReplyNotSupported,
  EndpointNotFound
]

/**
 * The bus' default recoverability policy. It retries a failed message after `delay` until it has been attempted
 * `maxAttempts` times, then moves it to the dead letter queue. Messages that fail with an `unrecoverable` error, or
 * one of `ALWAYS_UNRECOVERABLE`, are dead-lettered straight away.
 * @param options the attempts, delay and unrecoverable errors
 * @returns a policy for `Bus.configure().withRecoverability()`
 * @example
 * Bus.configure().withRecoverability(
 *   defaultRecoverability({ maxAttempts: 5, delay: 1_000, unrecoverable: [ValidationError] })
 * )
 */
export const defaultRecoverability = ({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  delay = exponentialBackoff(),
  unrecoverable = []
}: DefaultRecoverabilityOptions = {}): RecoverabilityPolicy => {
  const retryDelay: RetryDelay = typeof delay === 'number' ? () => delay : delay
  const unrecoverableErrors = [...ALWAYS_UNRECOVERABLE, ...unrecoverable]
  return ({ error, failedAttempts }) => {
    if (failedAttempts >= maxAttempts || causedBy(error, unrecoverableErrors)) {
      return deadLetter()
    }
    return retry(retryDelay(failedAttempts))
  }
}
