import { RedisTransport } from './redis-transport'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { DefaultHandlerRegistry, HandlerAlreadyRegistered, JsonSerializer, MessageSerializer } from '../../bus-core/dist'

const configuration: RedisTransportConfiguration = {
  queueName: 'node-ts/bus-redis-test',
  connectionString: 'redis://127.0.0.1:6379',
  maxRetries: 3
}

describe('RedisTransport', () => {
  jest.setTimeout(30000)

  const redisTransport = new RedisTransport(configuration)

  async function purgeQueue() {
    return redisTransport['queue'].destroyQueue()
  }

  const systemMessageTopicIdentifier = TestSystemMessage.NAME
  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    const attributes = { systemMessage: systemMessageAttribute }
    const messageSerializer = new MessageSerializer(
      new JsonSerializer(),
      new DefaultHandlerRegistry()
    )
    const payload = {
      message: messageSerializer.serialize(message),
      correlationId: undefined,
      attributes: attributes,
      stickyAttributes: {}
    }

    redisTransport['queue'].publish(payload.message)
  }

  const readAllFromDeadLetterQueue = async () => {
    // TODO does modest-queue support DLQing?
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
