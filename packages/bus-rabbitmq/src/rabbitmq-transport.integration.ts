import { RabbitMqTransport } from './rabbitmq-transport'
import {
  TestEvent,
  TestCommand,
  testCommandHandler,
  TestPoisonedMessage,
  TestFailMessage,
  TestPoisonedMessageHandler,
  HandleChecker
} from '../test'
import { Connection, Channel, Message as RabbitMqMessage, connect, ConsumeMessage } from 'amqplib'
import { TransportMessage, Bus, Logger, HandlerContext, MessageSerializer } from '@node-ts/bus-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import * as faker from 'faker'
import { Message, MessageAttributeMap, MessageAttributes } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import uuid from 'uuid'
import { EventEmitter } from 'stream'
import { transportTests, TestSystemMessage } from '@node-ts/bus-test'

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

const configuration: RabbitMqTransportConfiguration = {
  queueName: 'node-ts/bus-rabbitmq-test',
  connectionString: 'amqp://guest:guest@0.0.0.0',
  maxRetries: 10
}

jest.setTimeout(10000)

describe('RabbitMqTransport', () => {
  let rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: Connection
  let channel: Channel
  let handleChecker: IMock<HandleChecker>

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

  const deadLetterQueueName = 'dead-letter'
  const readAllFromDeadLetterQueue = async () => {
    // Wait for message to arrive to give the handler time to fail it
    const rabbitMessage = await new Promise<ConsumeMessage>(async resolve => {
      const consumerTag = uuid.v4()
      channel.consume(
        deadLetterQueueName,
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
    await channel.purgeQueue(deadLetterQueueName)

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
    await Promise.all([
      channel.purgeQueue(configuration.queueName),
      channel.purgeQueue(deadLetterQueueName)
    ])
  })

  transportTests(
    rabbitMqTransport,
    publishSystemMessage,
    systemMessageTopicIdentifier,
    readAllFromDeadLetterQueue
  )

  // beforeAll(async () => {
  //   await Bus.configure()
  //     .withTransport(rabbitMqTransport)
  //     .withLogger(() => Mock.ofType<Logger>().object)
  //     .withContainer({
  //       get: _ => new TestPoisonedMessageHandler(handleChecker.object) as any
  //     })
  //     .withHandler(TestCommand, testCommandHandler)
  //     .withHandler(TestPoisonedMessage, TestPoisonedMessageHandler)
  //     .withHandler(TestFailMessage, async () => Bus.fail())
  //     .withHandler<TestSystemMessage>(
  //       TestSystemMessage,
  //       async ({ message, attributes }: HandlerContext<TestSystemMessage>) => handleChecker.object.check(message, attributes),
  //       {
  //         resolveWith: m => m.$name === TestSystemMessage.NAME,
  //         topicIdentifier: TestSystemMessage.NAME
  //       }
  //     )
  //     .initialize()

  //   connection = await connect(configuration.connectionString)
  //   channel = await connection.createChannel()
  //   handleChecker = Mock.ofType<HandleChecker>()

  //   await Bus.start()
  // })

  afterAll(async () => {
    await channel.deleteExchange(systemMessageTopicIdentifier)
    await channel.close()
    await connection.close()
    await Bus.dispose()
  })

  // describe('when initializing the transport', () => {

  //   it('should create a service queue in rabbitmq', async () => {
  //     const queue = await channel.checkQueue(configuration.queueName)
  //     expect(queue).toBeDefined()
  //   })

  //   describe('when publishing an event', () => {
  //     const event = new TestEvent()

  //     beforeEach(async () => {
  //       await Bus.publish(event)
  //     })

  //     it('should create a fanout exchange with the name of the event', async () => {
  //       const exchange = await channel.checkExchange(TestEvent.NAME)
  //       expect(exchange).toBeDefined()
  //     })
  //   })

  //   describe('when retrying a poisoned message', () => {
  //     const poisonedMessage = new TestPoisonedMessage(faker.random.uuid())
  //     beforeAll(async () => {
  //       jest.setTimeout(10000)
  //       const events = new EventEmitter()
  //       const consumerTag = faker.random.uuid()
  //       channel.consume('dead-letter', msg => {
  //         if (!msg) {
  //           return
  //         }

  //         channel.ack(msg)
  //         channel.cancel(consumerTag)

  //         const message = JSON.parse(msg.content.toString()) as TestPoisonedMessage

  //         if (message.id === poisonedMessage.id) {
  //           events.emit('event', message)
  //         }
  //       }, { consumerTag})

  //       const messageFailed = new Promise<void>(resolve => events.on('event', resolve))
  //       await Bus.publish(poisonedMessage),
  //       await messageFailed
  //     })

  //     it(`it should fail after configuration.maxRetries attempts`, () => {
  //       handleChecker.verify(
  //         h => h.check(It.is<TestPoisonedMessage>(m => m.id === poisonedMessage.id), It.isAny()),
  //         Times.exactly(configuration.maxRetries!)
  //       )
  //     })
  //   })

  //   describe('when sending a command', () => {
  //     const command = new TestCommand()
  //     beforeEach(async () => {
  //       await Bus.send(command)
  //     })

  //     afterEach(async () => {
  //       await channel.purgeQueue(configuration.queueName)
  //     })

  //     it('should create a fanout exchange with the name of the command', async () => {
  //       const exchange = await channel.checkExchange(TestCommand.NAME)
  //       expect(exchange).toBeDefined()
  //     })
  //   })

  //   describe('when sending a system message', () => {
  //     const command = new TestSystemMessage()
  //     const channelName = TestSystemMessage.NAME

  //     beforeAll(async () => {
  //       jest.setTimeout(10000)
  //       channel.publish(channelName, '', Buffer.from(JSON.stringify(command)), { messageId: uuid.v4() })
  //       await sleep(2000)
  //     })

  //     afterAll(async () => {
  //       await channel.deleteExchange(command.name)
  //     })

  //     it('should handle system messages', async () => {
  //       handleChecker.verify(
  //         h => h.check(It.is<TestSystemMessage>(m => m.name === TestSystemMessage.NAME), It.isAny()),
  //         Times.once()
  //       )
  //     })
  //   })

  //   describe('when receiving the next message', () => {
  //     describe('from a queue with messages', () => {
  //       const command = new TestCommand()
  //       let message: TransportMessage<RabbitMqMessage> | undefined
  //       const messageOptions: Partial<MessageAttributes> = {
  //         correlationId: faker.random.uuid(),
  //         attributes: {
  //           attribute1: 'a',
  //           attribute2: 1
  //         },
  //         stickyAttributes: {
  //           attribute1: 'b',
  //           attribute2: 2
  //         }
  //       }

  //       beforeEach(async () => {
  //         await Bus.send(command, messageOptions)
  //         message = await rabbitMqTransport.readNextMessage()
  //       })

  //       afterEach(async () => {
  //         if (message) {
  //           await rabbitMqTransport.deleteMessage(message)
  //         }
  //       })

  //       it('should return the first message', () => {
  //         expect(message).toBeDefined()
  //         expect(message!.domainMessage).toMatchObject(command)
  //       })

  //       it('should receive the message options', () => {
  //         expect(message!.attributes).toBeDefined()
  //         expect(message!.attributes.correlationId).toEqual(messageOptions.correlationId)
  //         expect(message!.attributes.attributes).toMatchObject(messageOptions.attributes!)
  //         expect(message!.attributes.stickyAttributes).toMatchObject(messageOptions.stickyAttributes!)
  //       })

  //       it('should should not ack the message from the queue', async () => {
  //         const queueDetails = await channel.checkQueue(configuration.queueName) as { messageCount: number }
  //         expect(queueDetails.messageCount).toEqual(0)
  //       })
  //     })
  //   })

  //   describe('when failing a message', () => {
  //     const failMessage = new TestFailMessage(faker.random.uuid())
  //     const correlationId = faker.random.uuid()
  //     let deadLetter: TestFailMessage | undefined
  //     let rawDeadLetter: ConsumeMessage

  //     beforeAll(async () => {
  //       await Bus.publish(failMessage, { correlationId })
  //       await new Promise<void>(resolve => {
  //         const consumerTag = faker.random.uuid()
  //         channel.consume(
  //           'dead-letter',
  //           msg => {
  //             if (!msg) {
  //               return
  //             }

  //             channel.ack(msg)
  //             channel.cancel(consumerTag)

  //             const message = JSON.parse(msg.content.toString()) as TestFailMessage
  //             if (message.id === failMessage.id) {
  //               deadLetter = message
  //               rawDeadLetter = msg
  //               resolve()
  //             }
  //           },
  //           { consumerTag })
  //       })
  //     })

  //     it('should deliver the failed message to the dead letter queue', () => {
  //       expect(deadLetter).toBeDefined()
  //     })

  //     it('should remove the message from the source queue', async () => {
  //       const queueDetails = await channel.checkQueue(configuration.queueName) as { messageCount: number }
  //       expect(queueDetails.messageCount).toEqual(0)
  //     })

  //     it('should retain the same message attributes', () => {
  //       expect(rawDeadLetter.properties.correlationId).toEqual(correlationId)
  //     })
  //   })
  // })
})
