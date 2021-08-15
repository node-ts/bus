import { RedisTransport } from './redis-transport'
import { MessageSerializer } from '@node-ts/bus-core'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'

const configuration: RedisTransportConfiguration = {
  queueName: 'node-ts/bus-redis-test',
  connectionString: 'redis://127.0.0.1:6379',
  maxRetries: 3
}

describe('RedisTransport', () => {
  jest.setTimeout(30000)

  const redisTransport = new RedisTransport(configuration)

  /**
   * removes all jobs irrespective of their state
   * 'completed' | 'wait' | 'active' | 'paused' | 'delayed' | 'failed'
   */
  async function purgeQueue() {
    return Promise.all(
      ['completed','wait','active','paused','delayed','failed']
        .map(jobState => redisTransport['queue'].clean(2000, 100, jobState as any)))
  }

  const systemMessageTopicIdentifier = TestSystemMessage.NAME
  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    const attributes = { systemMessage: systemMessageAttribute }

    const payload = {
      message: MessageSerializer.serialize(message as any),
      correlationId: undefined,
      attributes: attributes,
      stickyAttributes: {}
    }

    redisTransport['queue'].add(systemMessageTopicIdentifier, payload)
  }

  const readAllFromDeadLetterQueue = async () => {
    return []
  }

  beforeAll(async () => {
    await purgeQueue()
  })

  transportTests(
    redisTransport,
    publishSystemMessage,
    systemMessageTopicIdentifier,
    readAllFromDeadLetterQueue
  )

})
