/**
 * Controls how the RabbitMQ transport recovers when its connection or channel to the broker is lost.
 *
 * Reconnect attempts back off exponentially: the delay before attempt `n` is
 * `initialDelay * factor ^ (n - 1)`, capped at `maxDelay`.
 */
export interface RabbitMqConnectionRecoveryConfiguration {
  /**
   * Whether to reconnect when the connection or channel is lost. When disabled, a lost connection
   * isn't recovered and the transport stops receiving messages.
   * @default true
   */
  enabled?: boolean

  /**
   * The delay in milliseconds before the first reconnect attempt.
   * @default 100
   */
  initialDelay?: number

  /**
   * The longest delay in milliseconds between reconnect attempts.
   * @default 30000
   */
  maxDelay?: number

  /**
   * The multiplier applied to the delay after each failed attempt.
   * @default 2
   */
  factor?: number

  /**
   * The fraction (0-1) of each connection reconnect delay that's randomised, so that many services
   * don't all reconnect at the same moment.
   * @default 0.2
   */
  jitter?: number

  /**
   * The number of reconnect attempts before giving up. Once recovery gives up, publishing and
   * sending throw `RabbitMqConnectionRecoveryFailed` and no more messages are received.
   * @default Infinity
   */
  maxRetries?: number
}
