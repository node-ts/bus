/**
 * Thrown when `RedisTransport` is configured with a `queueName` or `keyPrefix` it can't build Redis keys from, such as
 * one that's empty or contains `{` or `}`. Every key of a queue shares the queue's name as a hash tag (`{<queueName>}`),
 * so braces in it would change which part of the key Redis Cluster hashes.
 */
export class InvalidRedisKeyName extends Error {
  readonly help: string

  /**
   * @param setting the configuration setting that's invalid
   * @param value the value it was given
   */
  constructor(
    readonly setting: 'queueName' | 'keyPrefix',
    readonly value: string
  ) {
    super(
      `RedisTransport's ${setting} must be a non-empty string without "{" or "}", but was "${value}"`
    )
    this.help = `Change ${setting} in the RedisTransport configuration to a name without braces, such as "order-booking-service"`
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
