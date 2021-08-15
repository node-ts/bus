import { RabbitMqTransport } from './rabbitmq-transport'
import { Connection, Channel, connect, ConsumeMessage } from 'amqplib'
import { Bus, MessageSerializer } from '@node-ts/bus-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import { Message, MessageAttributeMap, MessageAttributes } from '@node-ts/bus-messages'
import uuid from 'uuid'
import { transportTests, TestSystemMessage } from '@node-ts/bus-test'

const configuration: RabbitMqTransportConfiguration = {
  queueName: '@node-ts/bus-rabbitmq-test',
  deadLetterQueueName: '@node-ts/bus-rabbitmq-test-dead-letter',
  connectionString: 'amqp://guest:guest@0.0.0.0',
  maxRetries: 10
}

describe('RabbitMqTransport', () => {
  jest.setTimeout(10000)

  let rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: Connection
  let channel: Channel

  const systemMessageTopicIdentifier = TestSystemMessage.NAME
  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    const attributes = { systemMessage: systemMessageAttribute }
    channel.publish(
      systemMessageTopicIdentifier,
      '',
      Buffer.from(JSON.stringify(message)),
      {
        messageId: uuid.v4(),
        headers: {
          attributes: JSON.stringify(attributes)
        }
      }
    )
  }

  const readAllFromDeadLetterQueue = async () => {
    // Wait for message to arrive to give the handler time to fail it
    const rabbitMessage = await new Promise<ConsumeMessage>(async resolve => {
      const consumerTag = uuid.v4()
      channel.consume(
        configuration.deadLetterQueueName,
        message => {
          channel.ack(message)
          channel.cancel(consumerTag)
          resolve(message)
        },
        {
          consumerTag
        }
      )
    })
    await channel.purgeQueue(configuration.deadLetterQueueName)

    const payload = rabbitMessage.content.toString('utf8')
    const message = MessageSerializer.deserialize(payload) as Message

    const attributes: MessageAttributes = {
      correlationId: rabbitMessage.properties.correlationId as string,
      attributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.attributes
        ? JSON.parse(rabbitMessage.properties.headers.attributes as string) as MessageAttributeMap
        : {},
      stickyAttributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.stickyAttributes
        ? JSON.parse(rabbitMessage.properties.headers.stickyAttributes as string) as MessageAttributeMap
        : {}
    }

    return [{ message, attributes }]
  }

  beforeAll(async () => {
    connection = await connect(configuration.connectionString)
    channel = await connection.createChannel()
    // Ignore failures due to queues that don't yet exist
    await Promise.allSettled([
      channel.purgeQueue(configuration.queueName),
      channel.purgeQueue(configuration.deadLetterQueueName)
    ])
  })

  transportTests(
    rabbitMqTransport,
    publishSystemMessage,
    systemMessageTopicIdentifier,
    readAllFromDeadLetterQueue
  )

  afterAll(async () => {
    await channel.deleteExchange(systemMessageTopicIdentifier)
    await channel.close()
    await connection.close()
    await Bus.dispose()
  })
})
