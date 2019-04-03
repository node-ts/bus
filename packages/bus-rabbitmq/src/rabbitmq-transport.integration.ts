import { RabbitMqTransport } from './rabbitmq-transport'
import { TestContainer, TestEvent, TestCommand, TestCommandHandler } from '../test'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS, BUS_RABBITMQ_SYMBOLS } from './bus-rabbitmq-symbols'
import { Connection, Channel, Message as RabbitMqMessage } from 'amqplib'
import { TransportMessage, BUS_SYMBOLS, ApplicationBootstrap, HandlerRegistry } from '@node-ts/bus-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

const configuration: RabbitMqTransportConfiguration = {
  queueName: 'node-ts/bus-rabbitmq-test',
  connectionString: 'amqp://guest:guest@localhost'
}

describe('RabbitMqTransport', () => {
  let sut: RabbitMqTransport
  let connection: Connection
  let channel: Channel
  let container: TestContainer

  beforeAll(async () => {
    container = new TestContainer()
    container.bind(BUS_RABBITMQ_SYMBOLS.TransportConfiguration).toConstantValue(configuration)
    sut = container.get(BUS_RABBITMQ_INTERNAL_SYMBOLS.RabbitMqTransport)

    const bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    bootstrap.registerHandler(TestCommandHandler)

    const connectionFactory = container.get<() => Promise<Connection>>(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
    connection = await connectionFactory()
    channel = await connection.createChannel()
  })

  afterAll(async () => {
    await channel.close()
    await connection.close()
  })

  describe('when initializing the transport', () => {
    beforeEach(async () => {
      await sut.initialize(container.get<HandlerRegistry>(BUS_SYMBOLS.HandlerRegistry))
    })

    afterEach(async () => {
      await sut.dispose()
    })

    it('should create a service queue in rabbitmq', async () => {
      const queue = await channel.checkQueue(configuration.queueName)
      expect(queue).toBeDefined()
    })

    describe('when publishing an event', () => {
      const event = new TestEvent()
      beforeEach(async () => {
        await sut.publish(event)
      })

      it('should create a fanout exchange with the name of the event', async () => {
        const exchange = await channel.checkExchange(TestEvent.NAME)
        expect(exchange).toBeDefined()
      })
    })

    describe('when sending a command', () => {
      const command = new TestCommand()
      beforeEach(async () => {
        await sut.send(command)
      })

      afterEach(async () => {
        await channel.purgeQueue(configuration.queueName)
      })

      it('should create a fanout exchange with the name of the command', async () => {
        const exchange = await channel.checkExchange(TestCommand.NAME)
        expect(exchange).toBeDefined()
      })
    })

    describe('when receiving the next message', () => {
      describe('from an empty queue', () => {
        it('should return undefined', async () => {
          const message = await sut.readNextMessage()
          expect(message).toBeUndefined()
        })
      })

      describe('from a queue with messages', () => {
        const command = new TestCommand()
        let message: TransportMessage<RabbitMqMessage> | undefined

        beforeEach(async () => {
          await sut.send(command)
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

        it('should should not ack the message from the queue', async () => {
          const queueDetails = await channel.checkQueue(configuration.queueName) as { messageCount: number }
          expect(queueDetails.messageCount).toEqual(0)
        })
      })
    })
  })
})
