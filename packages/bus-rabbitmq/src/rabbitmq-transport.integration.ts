import {
  DefaultHandlerRegistry,
  JsonSerializer,
  MessageSerializer
} from '@node-ts/bus-core'
import {
  Message,
  MessageAttributeMap,
  MessageAttributes
} from '@node-ts/bus-messages'
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { Channel, connect, Connection, ConsumeMessage } from 'amqplib'
import * as uuid from 'uuid'
import { RabbitMqTransport } from './rabbitmq-transport'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'

const configuration: RabbitMqTransportConfiguration = {
  queueName: '@node-ts/bus-rabbitmq-test',
  deadLetterQueueName: '@node-ts/bus-rabbitmq-test-dead-letter',
  connectionString: process.env.RABBITMQ_URL || 'amqp://guest:guest@0.0.0.0',
  maxRetries: 10
}

describe('RabbitMqTransport', () => {
  jest.setTimeout(10000)

  let rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: Connection
  let channel: Channel
  const messageSerializer = new MessageSerializer(
    new JsonSerializer(),
    new DefaultHandlerRegistry()
  )

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
        configuration.deadLetterQueueName!,
        message => {
          channel.ack(message!)
          channel.cancel(consumerTag)
          resolve(message!)
        },
        {
          consumerTag
        }
      )
    })
    await channel.purgeQueue(configuration.deadLetterQueueName!)

    const payload = rabbitMessage.content.toString('utf8')
    const message = messageSerializer.deserialize(payload) as Message

    const attributes: MessageAttributes = {
      correlationId: rabbitMessage.properties.correlationId as string,
      attributes:
        rabbitMessage.properties.headers &&
        rabbitMessage.properties.headers.attributes
          ? (JSON.parse(
              rabbitMessage.properties.headers.attributes as string
            ) as MessageAttributeMap)
          : {},
      stickyAttributes:
        rabbitMessage.properties.headers &&
        rabbitMessage.properties.headers.stickyAttributes
          ? (JSON.parse(
              rabbitMessage.properties.headers.stickyAttributes as string
            ) as MessageAttributeMap)
          : {}
    }

    return [{ message, attributes }]
  }

  beforeAll(async () => {
    connection = await connect(configuration.connectionString)
    // Purging a queue that doesn't exist yet (e.g. on a fresh broker in CI) makes the
    // server close the channel, so purge on a throwaway channel per queue
    for (const queueName of [
      configuration.queueName,
      configuration.deadLetterQueueName!
    ]) {
      const purgeChannel = await connection.createChannel()
      purgeChannel.on('error', () => undefined)
      try {
        await purgeChannel.purgeQueue(queueName)
        await purgeChannel.close()
      } catch {
        // Queue doesn't exist yet and the server has already closed the channel
      }
    }
    channel = await connection.createChannel()
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
  })
})
