export type Milliseconds = number

/**
 * Defines how a message retry strategy is to be implements that calculates the delay between subsequent
 * retries of a message.
 */
export interface RetryStrategy {
  /**
   * Calculate the delay between retrying a failed message
   * @param currentAttempt How many attempts at handling the message have failed
   * @returns The number of milliseconds to delay retrying a failed message attempt
   */
  calculateRetryDelay (currentAttempt: number): Milliseconds
}
