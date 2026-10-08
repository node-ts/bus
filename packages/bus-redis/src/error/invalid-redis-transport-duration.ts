/**
 * Thrown when `RedisTransport` is configured with a duration it can't use: a `visibilityTimeoutMs` that isn't a
 * positive whole number of milliseconds, or a `deadLetterRetentionMs` that isn't 0 or more whole milliseconds, or
 * `Infinity`. Redis takes these as integers.
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
        ? `RedisTransport's visibilityTimeoutMs must be a positive whole number of milliseconds, but was ${String(value)}`
        : `RedisTransport's deadLetterRetentionMs must be 0 or more whole milliseconds, or Infinity, but was ${String(value)}`
    )
    this.help =
      setting === 'visibilityTimeoutMs'
        ? 'Set visibilityTimeoutMs in the RedisTransport configuration to a whole number above 0, or leave it out to use the default'
        : 'Set deadLetterRetentionMs in the RedisTransport configuration to how long to keep dead letters in whole milliseconds, 0 or Infinity to keep them until removed, or leave it out to use the default'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
