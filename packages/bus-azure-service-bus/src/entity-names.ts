import { createHash } from 'node:crypto'

/**
 * The longest topic or queue name Service Bus accepts
 */
export const MAX_TOPIC_NAME_LENGTH = 260

/**
 * The longest subscription or rule name Service Bus accepts
 */
export const MAX_SUBSCRIPTION_NAME_LENGTH = 50

/**
 * How many hex characters of a hash are appended to a name that had to be shortened
 */
const HASH_LENGTH = 8

/**
 * Characters Service Bus doesn't allow in an entity name. It allows `/` as a path separator, but the transport
 * replaces it so each topic is a single segment, as on other brokers.
 */
const INVALID_ENTITY_NAME_CHARACTERS = /[^a-zA-Z0-9._-]/g

/**
 * Shortens a name to `maxLength`, replacing its end with a hash of the whole name, so two long names that share a
 * beginning still get different results. A name that fits is returned as it is.
 * @param name the name to shorten
 * @param maxLength the longest name allowed
 */
export const shortenName = (name: string, maxLength: number): string => {
  if (name.length <= maxLength) {
    return name
  }
  const hash = createHash('sha256')
    .update(name)
    .digest('hex')
    .slice(0, HASH_LENGTH)
  return `${name.slice(0, maxLength - HASH_LENGTH - 1)}-${hash}`
}

/**
 * Resolves the name of the topic a message is sent to: its `$name` without a leading `@`, with each character Service
 * Bus doesn't allow replaced by `-`, and shortened and hashed when it's longer than 260 characters.
 * @param messageName the `$name` of the message
 * @returns a valid Service Bus topic name
 * @example
 * resolveTopicName('@node-ts/bus-test/test-command') // 'node-ts-bus-test-test-command'
 */
export const resolveTopicName = (messageName: string): string =>
  shortenName(
    messageName.replace(/^@/, '').replace(INVALID_ENTITY_NAME_CHARACTERS, '-'),
    MAX_TOPIC_NAME_LENGTH
  )

/**
 * Resolves the name of a service's subscription on a topic: its queue name, shortened and hashed when it's longer
 * than 50 characters
 * @param queueName the name of the service queue the subscription forwards to
 */
export const resolveSubscriptionName = (queueName: string): string =>
  shortenName(queueName, MAX_SUBSCRIPTION_NAME_LENGTH)
