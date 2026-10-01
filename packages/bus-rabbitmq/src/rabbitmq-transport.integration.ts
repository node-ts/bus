import {
  Bus,
  BusInstance,
  DefaultHandlerRegistry,
  handlerFor,
  JsonSerializer,
  Logger,
  MessageSerializer,
  sleep
} from '@node-ts/bus-core'
import {
  Message,
  MessageAttributeMap,
  MessageAttributes
} from '@node-ts/bus-messages'
import {
  HandleChecker,
  TestSystemMessage,
  transportTests
} from '@node-ts/bus-test'
import { Channel, ChannelModel, connect, ConsumeMessage } from 'amqplib'
import { EventEmitter } from 'events'
import { randomUUID } from 'node:crypto'
import { It, Mock, Times } from 'typemoq'
import { RabbitMqConnectionRecoveryFailed } from './error'
import { RabbitMqTransport } from './rabbitmq-transport'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import {
  closeConnections,
  getQueues,
  TestCommand,
  TestRetryCommand
} from './test'

const configuration: RabbitMqTransportConfiguration = {
  queueName: '@node-ts/bus-rabbitmq-test',
  deadLetterQueueName: '@node-ts/bus-rabbitmq-test-dead-letter',
  connectionString: process.env.RABBITMQ_URL || 'amqp://guest:guest@0.0.0.0',
  maxRetries: 10
}

describe('RabbitMqTransport', () => {
  jest.setTimeout(10000)

  const rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: ChannelModel
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
        messageId: randomUUID(),
        headers: {
          attributes: JSON.stringify(attributes)
        }
      }
    )
  }

  const readAllFromDeadLetterQueue = async () => {
    // Wait for message to arrive to give the handler time to fail it
    const rabbitMessage = await new Promise<ConsumeMessage>(
      (resolve, reject) => {
        const consumerTag = randomUUID()
        channel
          .consume(
            configuration.deadLetterQueueName!,
            message => {
              channel.ack(message!)
              channel.cancel(consumerTag).then(() => resolve(message!), reject)
            },
            {
              consumerTag
            }
          )
          .catch(reject)
      }
    )
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

  describe('with connection recovery', () => {
    const recoveryConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-recovery-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-recovery-test-dead-letter',
      connectionString: configuration.connectionString,
      connectionRecovery: { initialDelay: 50, maxDelay: 500 }
    }
    const sut = new RabbitMqTransport(recoveryConfiguration)
    const handleChecker = Mock.ofType<HandleChecker>()
    const logger = Mock.ofType<Logger>()
    const handlerEvents = new EventEmitter()
    const heldValues = new Set<string>()
    let releaseHeldHandler: () => void = () => undefined
    let bus: BusInstance

    /**
     * Resolves once the command with the given value has been handled `count` times
     */
    const handled = (value: string, count = 1) =>
      new Promise<void>(resolve => {
        let received = 0
        const listener = (command: TestCommand) => {
          if (command.value === value && ++received === count) {
            handlerEvents.off('received', listener)
            resolve()
          }
        }
        handlerEvents.on('received', listener)
      })

    const sendAndWaitForHandling = async (value: string) => {
      const commandHandled = handled(value)
      await bus.send(new TestCommand(value))
      await commandHandled
    }

    beforeAll(async () => {
      const purgeChannel = await connection.createChannel()
      purgeChannel.on('error', () => undefined)
      await purgeChannel
        .purgeQueue(recoveryConfiguration.queueName)
        .catch(() => undefined)

      bus = Bus.configure()
        .withTransport(sut)
        .withLogger(() => logger.object)
        .withConcurrency(2)
        .withHandler(
          handlerFor(TestCommand, async (command, attributes) => {
            handleChecker.object.check(command, attributes)
            handlerEvents.emit('received', command)
            if (command.holdHandler && !heldValues.has(command.value)) {
              heldValues.add(command.value)
              await new Promise<void>(resolve => (releaseHeldHandler = resolve))
            }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => {
      await bus.dispose()
      await channel.deleteExchange(TestCommand.NAME)
    })

    describe('when the channel is closed by the broker', () => {
      beforeAll(async () => {
        // Checking a queue that doesn't exist makes the broker close the channel
        await sut['channel']!.checkQueue(randomUUID()).catch(() => undefined)
        await sendAndWaitForHandling('after-channel-closed')
      })

      it('should reopen the channel and keep handling messages', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isObjectWith<TestCommand>({ value: 'after-channel-closed' }),
              It.isAny()
            ),
          Times.once()
        )
      })

      it('should resume consuming with a single consumer', async () => {
        const { consumerCount } = await channel.checkQueue(
          recoveryConfiguration.queueName
        )
        expect(consumerCount).toEqual(1)
      })
    })

    describe('when the connection is closed by the broker', () => {
      beforeAll(async () => {
        // Deleting the queue proves the topology is declared again on reconnect
        await channel.deleteQueue(recoveryConfiguration.queueName)
        await closeConnections(recoveryConfiguration.queueName)
        await sendAndWaitForHandling('after-connection-closed')
      })

      it('should reconnect, declare the topology and keep handling messages', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isObjectWith<TestCommand>({
                value: 'after-connection-closed'
              }),
              It.isAny()
            ),
          Times.once()
        )
      })

      it('should resume consuming with a single consumer', async () => {
        const { consumerCount } = await channel.checkQueue(
          recoveryConfiguration.queueName
        )
        expect(consumerCount).toEqual(1)
      })
    })

    describe('when the connection is lost while a message is being handled', () => {
      let channelAfterRedelivery: Channel | undefined

      beforeAll(async () => {
        const firstDelivery = handled('in-flight')
        const redelivery = handled('in-flight', 2)
        await bus.send(new TestCommand('in-flight', true))
        await firstDelivery

        await closeConnections(recoveryConfiguration.queueName)
        await redelivery
        channelAfterRedelivery = sut['channel']

        // Completing the first handling now tries to ack on the closed channel
        releaseHeldHandler()
        await sendAndWaitForHandling('after-in-flight')
      })

      it('should redeliver the message', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isObjectWith<TestCommand>({ value: 'in-flight' }),
              It.isAny()
            ),
          Times.exactly(2)
        )
      })

      it('should not ack the stale delivery on the new channel', () => {
        // Acking an unknown delivery tag would make the broker close the new channel
        expect(sut['channel']).toBe(channelAfterRedelivery)
      })

      it('should not log any errors', () => {
        logger.verify(l => l.error(It.isAny(), It.isAny()), Times.never())
      })
    })
  })

  describe('with a retry strategy', () => {
    const retryConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-retry-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-retry-test-dead-letter',
      connectionString: configuration.connectionString,
      maxRetries: 3
    }
    const sut = new RabbitMqTransport(retryConfiguration)
    const handlerEvents = new EventEmitter()
    /**
     * When each command was handled, by value
     */
    const handlings = new Map<string, number[]>()
    /**
     * The attempts the retry strategy was called with
     */
    let retryAttempts: number[] = []
    /**
     * The delays the retry strategy returns, in the order it's called
     */
    let retryDelays: number[] = []
    let bus: BusInstance

    /**
     * Resolves once the command with the given value has been handled `count` times
     */
    const handled = (value: string, count: number) =>
      new Promise<void>(resolve => {
        const listener = (command: TestRetryCommand) => {
          if (
            command.value === value &&
            handlings.get(value)!.length === count
          ) {
            handlerEvents.off('received', listener)
            resolve()
          }
        }
        handlerEvents.on('received', listener)
      })

    const readFromDeadLetterQueue = async () => {
      const deadLetterChannel = await connection.createChannel()
      const rabbitMessage = await new Promise<ConsumeMessage>(
        (resolve, reject) => {
          deadLetterChannel
            .consume(retryConfiguration.deadLetterQueueName!, message => {
              deadLetterChannel.ack(message!)
              resolve(message!)
            })
            .catch(reject)
        }
      )
      await deadLetterChannel.close()
      return JSON.parse(rabbitMessage.content.toString()) as TestRetryCommand
    }

    beforeAll(async () => {
      for (const queueName of [
        retryConfiguration.queueName,
        retryConfiguration.deadLetterQueueName!
      ]) {
        const purgeChannel = await connection.createChannel()
        purgeChannel.on('error', () => undefined)
        await purgeChannel.purgeQueue(queueName).catch(() => undefined)
      }

      bus = Bus.configure()
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withConcurrency(2)
        .withRetryStrategy({
          calculateRetryDelay(attempt: number): number {
            retryAttempts.push(attempt)
            return retryDelays.shift() ?? 0
          }
        })
        .withHandler(
          handlerFor(TestRetryCommand, async command => {
            const times = handlings.get(command.value) ?? []
            times.push(Date.now())
            handlings.set(command.value, times)
            handlerEvents.emit('received', command)
            if (times.length <= command.failures) {
              throw new Error('Test handler failure')
            }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => {
      await bus.dispose()
      await channel.deleteExchange(TestRetryCommand.NAME)
    })

    describe('when a message fails', () => {
      const retryDelay = 1000

      beforeAll(async () => {
        retryAttempts = []
        retryDelays = [retryDelay]
        const retried = handled('backoff', 2)
        await bus.send(new TestRetryCommand('backoff', 1))
        await retried
      })

      it('should wait for the retry delay before redelivering it', () => {
        const [firstHandled, secondHandled] = handlings.get('backoff')!
        expect(secondHandled - firstHandled).toBeGreaterThanOrEqual(retryDelay)
      })

      it('should pass the number of failed attempts to the retry strategy', () => {
        expect(retryAttempts).toEqual([0])
      })

      it('should declare the retry queues as durable', async () => {
        const retryQueues = await getQueues(
          `${retryConfiguration.queueName}-retry`
        )
        expect(retryQueues.length).toBeGreaterThan(0)
        retryQueues.forEach(queue => expect(queue.durable).toEqual(true))
      })
    })

    describe('when a message with a long delay fails before one with a short delay', () => {
      const longDelay = 3000
      const shortDelay = 100

      beforeAll(async () => {
        retryDelays = [longDelay, shortDelay]
        const slowRetried = handled('slow', 2)
        const fastHandled = handled('fast', 1)
        const fastRetried = handled('fast', 2)

        await bus.send(new TestRetryCommand('slow', 1))
        await handled('slow', 1)
        await bus.send(new TestRetryCommand('fast', 1))
        await fastHandled
        await fastRetried
        await slowRetried
      })

      it('should not hold the short delay back behind the long one', () => {
        const [fastFirst, fastSecond] = handlings.get('fast')!
        const [, slowSecond] = handlings.get('slow')!
        expect(fastSecond).toBeLessThan(slowSecond)
        expect(fastSecond - fastFirst).toBeLessThan(longDelay / 2)
      })
    })

    describe('when a message keeps failing', () => {
      let deadLetter: TestRetryCommand

      beforeAll(async () => {
        retryAttempts = []
        retryDelays = [10, 10, 10]
        await bus.send(new TestRetryCommand('poisoned', 100))
        deadLetter = await readFromDeadLetterQueue()
      })

      it('should retry until maxRetries then send it to the dead letter queue', () => {
        expect(deadLetter.value).toEqual('poisoned')
        expect(handlings.get('poisoned')).toHaveLength(
          retryConfiguration.maxRetries!
        )
      })

      it('should count each failed attempt', () => {
        expect(retryAttempts).toEqual([0, 1])
      })
    })
  })

  describe('without connection recovery', () => {
    const noRecoveryConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-no-recovery-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-no-recovery-test-dead-letter',
      connectionString: configuration.connectionString,
      connectionRecovery: { enabled: false }
    }
    const sut = new RabbitMqTransport(noRecoveryConfiguration)
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure()
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .asSendOnly()
        .build()
      await bus.initialize()
    })

    afterAll(async () => {
      await bus.dispose()
    })

    describe('when the connection is closed by the broker', () => {
      beforeAll(async () => {
        await closeConnections(noRecoveryConfiguration.queueName)
        while (!sut['recoveryFailure']) {
          await sleep(10)
        }
      })

      it('should throw when sending', async () => {
        await expect(bus.send(new TestCommand('no-recovery'))).rejects.toThrow(
          RabbitMqConnectionRecoveryFailed
        )
      })
    })
  })

  afterAll(async () => {
    await channel.deleteExchange(systemMessageTopicIdentifier)
    await channel.close()
    await connection.close()
  })
})
