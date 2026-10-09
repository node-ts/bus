import {
  MAX_SUBSCRIPTION_NAME_LENGTH,
  MAX_TOPIC_NAME_LENGTH,
  resolveSubscriptionName,
  resolveTopicName
} from './entity-names'

describe('resolveTopicName', () => {
  describe('when the message name has characters Service Bus does not allow', () => {
    it('should drop a leading @ and replace the rest with hyphens', () => {
      expect(resolveTopicName('@node-ts/bus-test/test-command')).toEqual(
        'node-ts-bus-test-test-command'
      )
    })

    it('should keep letters, digits, periods, hyphens and underscores', () => {
      expect(resolveTopicName('Orders.v2_created-event')).toEqual(
        'Orders.v2_created-event'
      )
    })
  })

  describe('when the message name is longer than a topic name can be', () => {
    const longName = 'a'.repeat(MAX_TOPIC_NAME_LENGTH + 10)

    it('should shorten it to the limit', () => {
      expect(resolveTopicName(longName)).toHaveLength(MAX_TOPIC_NAME_LENGTH)
    })

    it('should give names that share a beginning different topics', () => {
      expect(resolveTopicName(`${longName}-x`)).not.toEqual(
        resolveTopicName(`${longName}-y`)
      )
    })
  })
})

describe('resolveSubscriptionName', () => {
  it('should be the queue name when it fits', () => {
    expect(resolveSubscriptionName('orders')).toEqual('orders')
  })

  it('should shorten and hash a queue name over 50 characters', () => {
    const queueName = `${'q'.repeat(MAX_SUBSCRIPTION_NAME_LENGTH)}-orders`
    const subscriptionName = resolveSubscriptionName(queueName)
    expect(subscriptionName).toHaveLength(MAX_SUBSCRIPTION_NAME_LENGTH)
    expect(subscriptionName).toMatch(/^q+-[0-9a-f]{8}$/)
  })
})
