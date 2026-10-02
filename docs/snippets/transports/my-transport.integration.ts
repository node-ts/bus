/// <reference types="jest" />
// #region suite
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { brokerClient } from './broker-client'
import { MyTransport } from './my-transport'

jest.setTimeout(30_000)

describe('MyTransport', () => {
  const transport = new MyTransport(
    {
      queueName: 'bus-test',
      deadLetterQueueName: 'bus-test-dead-letter',
      connectionString: 'broker://localhost'
    },
    brokerClient
  )

  // The suite handles TestSystemMessage with withCustomHandler, subscribed to this topic
  const systemMessageTopic = 'bus-test-system'

  const publishSystemMessage = async (systemMessage: string) =>
    brokerClient.publish(
      systemMessageTopic,
      JSON.stringify(new TestSystemMessage()),
      { attributes: JSON.stringify({ systemMessage }) }
    )

  // Reads and removes every message on the dead letter queue
  const readAllFromDeadLetterQueue = async () => {
    const messages = await brokerClient.readAll('bus-test-dead-letter')
    return messages.map(raw => ({
      message: JSON.parse(raw.body),
      attributes: {
        correlationId: raw.headers.correlationId,
        attributes: JSON.parse(raw.headers.attributes ?? '{}'),
        stickyAttributes: JSON.parse(raw.headers.stickyAttributes ?? '{}')
      }
    }))
  }

  transportTests(
    transport,
    publishSystemMessage,
    systemMessageTopic,
    readAllFromDeadLetterQueue
  )
})
// #endregion suite
