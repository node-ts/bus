import { RabbitMqTransport } from './rabbitmq-transport'
import {
  TestContainer,
  TestEvent,
  TestCommand,
  TestCommandHandler,
  TestPoisonedMessageHandler,
  TestPoisonedMessage,
  HANDLE_CHECKER,
  HandleChecker,
  TestFailMessageHandler,
  TestFailMessage
} from '../test'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS, BUS_RABBITMQ_SYMBOLS } from './bus-rabbitmq-symbols'
import { Connection, Channel, Message as RabbitMqMessage } from 'amqplib'
import { TransportMessage, BUS_SYMBOLS, ApplicationBootstrap, Bus } from '@node-ts/bus-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import * as faker from 'faker'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestSystemMessage } from '../test/test-system-message'
import { TestSystemMessageHandler } from '../test/test-system-message-handler'
import { Mock, IMock, It, Times } from 'typemoq'

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

const configuration: RabbitMqTransportConfiguration = {
  queueName: 'node-ts/bus-rabbitmq-test',
  connectionString: 'amqp://guest:guest@0.0.0.0',
  maxRetries: 3
}

describe('RabbitMqTransport', () => {
  let bus: Bus
  let sut: RabbitMqTransport
  let connection: Connection
  let channel: Channel
  let container: TestContainer
  let bootstrap: ApplicationBootstrap
  let handleChecker: IMock<HandleChecker>

  beforeAll(async () => {
    handleChecker = Mock.ofType<HandleChecker>()
    container = new TestContainer()
    container.bind(HANDLE_CHECKER).toConstantValue(handleChecker.object)
    container.bind(BUS_RABBITMQ_SYMBOLS.TransportConfiguration).toConstantValue(configuration)
    bus = container.get(BUS_SYMBOLS.Bus)
    sut = container.get(BUS_SYMBOLS.Transport)

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    bootstrap.registerHandler(TestCommandHandler)
    bootstrap.registerHandler(TestSystemMessageHandler)
    bootstrap.registerHandler(TestPoisonedMessageHandler)
    bootstrap.registerHandler(TestFailMessageHandler)

    const connectionFactory = container.get<() => Promise<Connection>>(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
    connection = await connectionFactory()
    channel = await connection.createChannel()

    await channel.assertExchange(TestSystemMessage.NAME, 'fanout', { durable: true })

    await bootstrap.initialize(container)
  })

  afterAll(async () => {
    await channel.close()
    await connection.close()
    await bootstrap.dispose()
  })

  describe('when initializing the transport', () => {

    it('should create a service queue in rabbitmq', async () => {
      const queue = await channel.checkQueue(configuration.queueName)
      expect(queue).toBeDefined()
    })

    describe('when publishing an event', () => {
      const event = new TestEvent()

      beforeEach(async () => {
        await bus.publish(event)
      })

      it('should create a fanout exchange with the name of the event', async () => {
        const exchange = await channel.checkExchange(TestEvent.NAME)
        expect(exchange).toBeDefined()
      })
    })

    describe('when retrying a poisoned message', () => {
      const poisonedMessage = new TestPoisonedMessage(faker.random.uuid())
      beforeAll(async () => {
        jest.setTimeout(10000)
        await bus.publish(poisonedMessage)
        await new Promise<void>(resolve => {
          const consumerTag = faker.random.uuid()
          channel.consume('dead-letter', msg => {
            if (!msg) {
              return
            }

            channel.ack(msg)
            channel.cancel(consumerTag)

            const message = JSON.parse(msg.content.toString()) as TestPoisonedMessage
            if (message.id === poisonedMessage.id) {
              resolve()
            }
          }, { consumerTag})
        })
      })

      it(`it should fail after configuration.maxRetries attempts`, () => {
        handleChecker.verify(
          h => h.check(It.is<TestPoisonedMessage>(m => m.id === poisonedMessage.id), It.isAny()),
          Times.exactly(configuration.maxRetries!)
        )
      })
    })

    describe('when sending a command', () => {
      const command = new TestCommand()
      beforeEach(async () => {
        await bus.send(command)
      })

      afterEach(async () => {
        await channel.purgeQueue(configuration.queueName)
      })

      it('should create a fanout exchange with the name of the command', async () => {
        const exchange = await channel.checkExchange(TestCommand.NAME)
        expect(exchange).toBeDefined()
      })
    })

    describe('when sending a system message', () => {
      const command = new TestSystemMessage()
      const channelName = command.name

      beforeAll(async () => {
        jest.setTimeout(10000)
        channel.publish(channelName, '', Buffer.from(JSON.stringify(command)))
        await sleep(5000)
      })

      afterAll(async () => {
        await channel.deleteExchange(command.name)
      })

      it('should handle system messages', async () => {
        handleChecker.verify(
          h => h.check(It.is<TestSystemMessage>(m => m.name === command.name), It.isAny()),
          Times.once()
        )
      })
    })

    describe('when receiving the next message', () => {
      describe('from a queue with messages', () => {
        const command = new TestCommand()
        let message: TransportMessage<RabbitMqMessage> | undefined
        const messageOptions = new MessageAttributes({
          correlationId: faker.random.uuid(),
          attributes: {
            attribute1: 'a',
            attribute2: 1
          },
          stickyAttributes: {
            attribute1: 'b',
            attribute2: 2
          }
        })

        beforeEach(async () => {
          await bus.send(command, messageOptions)
          message = await sut.readNextMessage()
        })

        afterEach(async () => {
          if (message) {
            await sut.deleteMessage(message)
          }
        })

        it('should return the first message', () => {
          expect(message).toBeDefined()
          expect(message!.domainMessage).toMatchObject(command)
        })

        it('should receive the message options', () => {
          expect(message!.attributes).toBeDefined()
          expect(message!.attributes.correlationId).toEqual(messageOptions.correlationId)
          expect(message!.attributes.attributes).toMatchObject(messageOptions.attributes!)
          expect(message!.attributes.stickyAttributes).toMatchObject(messageOptions.stickyAttributes!)
        })

        it('should should not ack the message from the queue', async () => {
          const queueDetails = await channel.checkQueue(configuration.queueName) as { messageCount: number }
          expect(queueDetails.messageCount).toEqual(0)
        })
      })
    })

    describe('when failing a message', () => {
      const failMessage = new TestFailMessage(faker.random.uuid())
      let deadLetter: TestFailMessage | undefined
      beforeAll(async () => {
        await bus.publish(failMessage)
        await new Promise<void>(resolve => {
          const consumerTag = faker.random.uuid()
          channel.consume(
            'dead-letter',
            msg => {
              if (!msg) {
                return
              }

              channel.ack(msg)
              channel.cancel(consumerTag)

              const message = JSON.parse(msg.content.toString()) as TestPoisonedMessage
              if (message.id === failMessage.id) {
                deadLetter = message
                resolve()
              }
            },
            { consumerTag })
        })
      })

      it('should deliver the failed message to the dead letter queue', () => {
        expect(deadLetter).toBeDefined()
      })

      it('should remove the message from the source queue', async () => {
        const queueDetails = await channel.checkQueue(configuration.queueName) as { messageCount: number }
        expect(queueDetails.messageCount).toEqual(0)
      })
    })

  })
})
