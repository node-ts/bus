/**
 * Thrown when `PostgresTransport` is configured with a `pollIntervalMs` or `visibilityTimeoutMs` that isn't a
 * positive, finite number of milliseconds
 */
export class InvalidTransportDuration extends Error {
  readonly help: string

  /**
   * @param setting the configuration setting that's invalid
   * @param value the value it was given
   */
  constructor(
    readonly setting: 'pollIntervalMs' | 'visibilityTimeoutMs',
    readonly value: unknown
  ) {
    super(
      `PostgresTransport's ${setting} must be a positive number of milliseconds, but was ${String(value)}`
    )
    this.help = `Set ${setting} in the PostgresTransport configuration to a number above 0, or leave it out to use the default`
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
