import { Milliseconds } from '@node-ts/bus-core'

/**
 * The longest message TTL RabbitMQ accepts
 */
export const MAX_RETRY_DELAY: Milliseconds = 2 ** 32 - 1

/**
 * Turns a retry delay from the recoverability policy into a message TTL RabbitMQ accepts: a whole number of
 * milliseconds from 0 to `MAX_RETRY_DELAY`.
 * @param delay the delay the bus passed to `returnMessage`
 * @returns the delay rounded up and clamped to the TTL range
 */
export const toRetryDelay = (delay: Milliseconds): Milliseconds => {
  if (Number.isNaN(delay)) {
    return 0
  }
  return Math.min(Math.max(Math.ceil(delay), 0), MAX_RETRY_DELAY)
}

/**
 * Picks the retry queue a delayed message waits in. Each retry queue holds delays between half its
 * size and its size, rounded up to a power of two.
 *
 * RabbitMQ only expires messages from the head of a queue, so a message waits for the ones ahead of
 * it to expire first. Grouping similar delays keeps that wait under the queue size: a message waits
 * at most twice its own delay, and never less than it.
 * @param delay a delay from `toRetryDelay`
 * @returns the upper bound of the delays the queue holds, in milliseconds
 */
export const toRetryQueueDelay = (delay: Milliseconds): Milliseconds =>
  delay <= 1 ? 1 : 2 ** Math.ceil(Math.log2(delay))
