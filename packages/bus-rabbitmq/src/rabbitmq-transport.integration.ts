import { RabbitMqTransport } from './rabbitmq-transport'
import { TestEvent, TestCommand, testCommandHandler } from '../test'
import { Connection, Channel, Message as RabbitMqMessage, connect } from 'amqplib'
import { TransportMessage, Bus, Logger } from '@node-ts/bus-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import * as faker from 'faker'
import { MessageAttributes } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

const configuration: RabbitMqTransportConfiguration = {
  queueName: 'node-ts/bus-rabbitmq-test',
  connectionString: 'amqp://guest:guest@0.0.0.0'
}

describe('RabbitMqTransport', () => {
  let rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: Connection
  let channel: Channel

  beforeAll(async () => {
    await Bus.configure()
      .withTransport(rabbitMqTransport)
      .withLogger(Mock.ofType<Logger>().object)
      .withHandler(TestCommand, testCommandHandler)
      .initialize()

    connection = await connect(configuration.connectionString)
    channel = await connection.createChannel()
  })

  afterAll(async () => {
    await channel.close()
    await connection.close()
    await Bus.dispose()
  })

  describe('when initializing the transport', () => {

    it('should create a service queue in rabbitmq', async () => {
      const queue = await channel.checkQueue(configuration.queueName)
      expect(queue).toBeDefined()
    })

    describe('when publishing an event', () => {
      const event = new TestEvent()

      beforeEach(async () => {
        await Bus.publish(event)
      })

      it('should create a fanout exchange with the name of the event', async () => {
        const exchange = await channel.checkExchange(TestEvent.NAME)
        expect(exchange).toBeDefined()
      })
    })

    describe('when sending a command', () => {
      const command = new TestCommand()
      beforeEach(async () => {
        await Bus.send(command)
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
          await Bus.send(command, messageOptions)
          message = await rabbitMqTransport.readNextMessage()
        })

        afterEach(async () => {
          if (message) {
            await rabbitMqTransport.deleteMessage(message)
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
  })
})
