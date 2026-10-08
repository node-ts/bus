/**
 * Thrown when `RedisTransport` is configured with a duration it can't use: a `visibilityTimeoutMs` that isn't a
 * positive, finite number of milliseconds, or a `deadLetterRetentionMs` that's negative or not a number
 */
export class InvalidRedisTransportDuration extends Error {
  readonly help: string

  /**
   * @param setting the configuration setting that's invalid
   * @param value the value it was given
   */
  constructor(
    readonly setting: 'visibilityTimeoutMs' | 'deadLetterRetentionMs',
    readonly value: unknown
  ) {
    super(
      setting === 'visibilityTimeoutMs'
        ? `RedisTransport's visibilityTimeoutMs must be a positive number of milliseconds, but was ${String(value)}`
        : `RedisTransport's deadLetterRetentionMs must be 0 or more milliseconds, or Infinity, but was ${String(value)}`
    )
    this.help =
      setting === 'visibilityTimeoutMs'
        ? 'Set visibilityTimeoutMs in the RedisTransport configuration to a number above 0, or leave it out to use the default'
        : 'Set deadLetterRetentionMs in the RedisTransport configuration to how long to keep dead letters, 0 or Infinity to keep them until removed, or leave it out to use the default'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
