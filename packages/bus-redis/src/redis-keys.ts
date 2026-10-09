import { InvalidRedisKeyName } from './error'

/**
 * The prefix of every key, unless `keyPrefix` is set
 */
export const DEFAULT_KEY_PREFIX = 'bus'

const HASH_TAG_BRACES = /[{}]/

/**
 * Whether a name can be put in a key, inside a hash tag: it's not empty and has no braces
 */
export const isValidKeyName = (name: string): boolean =>
  typeof name === 'string' && name.length > 0 && !HASH_TAG_BRACES.test(name)

/**
 * Escapes the characters that are special in a Redis glob pattern (`*`, `?`, `[`, `]` and `\`), so an ACL key pattern
 * matches the name exactly
 */
export const escapeGlob = (name: string): string =>
  name.replace(/[*?[\]\\]/g, match => `\\${match}`)

/**
 * The names of the keys `RedisTransport` uses. Every key of a queue has the queue's name as its Redis Cluster hash tag,
 * so they're all in one hash slot, and a script can update them together.
 *
 * - `<prefix>:{<queue>}:queue`: the stream of messages waiting to be handled, read by the consumer group `<queue>`
 * - `<prefix>:{<queue>}:delayed`: a sorted set of returned messages, scored by when they're due
 * - `<prefix>:{<queue>}:dead-letter`: the stream of dead-lettered messages
 * - `<prefix>:subscriptions:<message name>`: the set of queues a message is sent to
 */
export class RedisKeys {
  /**
   * @param prefix what every key starts with
   * @throws InvalidRedisKeyName if the prefix is empty or has braces
   */
  constructor(readonly prefix: string) {
    if (!isValidKeyName(prefix)) {
      throw new InvalidRedisKeyName('keyPrefix', prefix)
    }
  }

  /**
   * The stream a queue's messages are sent to
   */
  queue(queueName: string): string {
    return `${this.prefix}:{${queueName}}:queue`
  }

  /**
   * The sorted set a queue's returned messages wait in until they're due
   */
  delayed(queueName: string): string {
    return `${this.prefix}:{${queueName}}:delayed`
  }

  /**
   * The stream a queue's dead-lettered messages are kept in
   */
  deadLetter(queueName: string): string {
    return `${this.prefix}:{${queueName}}:dead-letter`
  }

  /**
   * The set of the queues a message is sent to
   */
  subscriptions(messageName: string): string {
    return `${this.prefix}:subscriptions:${messageName}`
  }

  /**
   * An ACL key pattern for every key of one queue
   */
  queueKeysPattern(queueName: string): string {
    return `${escapeGlob(this.prefix)}:{${escapeGlob(queueName)}}:*`
  }

  /**
   * An ACL key pattern for the message stream of every queue
   */
  anyQueuePattern(): string {
    return `${escapeGlob(this.prefix)}:{*}:queue`
  }

  /**
   * An ACL key pattern for every subscription set
   */
  subscriptionsPattern(): string {
    return `${escapeGlob(this.prefix)}:subscriptions:*`
  }
}
