import {
  Bus,
  BusInstance,
  deadLetter,
  DefaultHandlerRegistry,
  FAILURE_HEADER,
  fromFailureHeader,
  handlerFor,
  JsonSerializer,
  Logger,
  MessageSerializer,
  retry,
  sleep,
  TransportHeaderReserved
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
  messageTypes,
  TestCommand,
  TestRetryCommand
} from './test'

const configuration: RabbitMqTransportConfiguration = {
  queueName: '@node-ts/bus-rabbitmq-test',
  deadLetterQueueName: '@node-ts/bus-rabbitmq-test-dead-letter',
  connectionString: process.env.RABBITMQ_URL || 'amqp://guest:guest@0.0.0.0'
}

describe('RabbitMqTransport', () => {
  jest.setTimeout(10000)

  const rabbitMqTransport = new RabbitMqTransport(configuration)
  let connection: ChannelModel
  let channel: Channel
  const messageSerializer = new MessageSerializer(
    new JsonSerializer(),
    new DefaultHandlerRegistry(),
    { messages: {}, types: {} }
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
      messageId: rabbitMessage.properties.messageId as string,
      sentAt: rabbitMessage.properties.headers?.sentAt as string | undefined,
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

    return [
      {
        message,
        attributes,
        failure: fromFailureHeader(
          rabbitMessage.properties.headers?.[FAILURE_HEADER]
        )
      }
    ]
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

  describe('when reading the endpoint name', () => {
    it('should be the queue name', () => {
      expect(rabbitMqTransport.endpointName).toEqual(configuration.queueName)
    })
  })

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
        .withMessageTypes(messageTypes)
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

  describe('with a message that cannot be parsed', () => {
    const poisonConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-poison-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-poison-test-dead-letter',
      connectionString: configuration.connectionString
    }
    const sut = new RabbitMqTransport(poisonConfiguration)
    const handlerEvents = new EventEmitter()
    const poisonPayload = '{not json'
    let handledAfterPoison: TestCommand
    let deadLetter: ConsumeMessage
    let bus: BusInstance

    /**
     * Resolves with the next message on the dead letter queue once it arrives. The transport
     * dead-letters on its own connection, so a single read of the queue can come before it's routed.
     */
    const nextDeadLetter = () =>
      new Promise<ConsumeMessage>((resolve, reject) => {
        const consumerTag = randomUUID()
        channel
          .consume(
            poisonConfiguration.deadLetterQueueName!,
            message => {
              channel.ack(message!)
              channel.cancel(consumerTag).then(() => resolve(message!), reject)
            },
            { consumerTag }
          )
          .catch(reject)
      })

    beforeAll(async () => {
      for (const queueName of [
        poisonConfiguration.queueName,
        poisonConfiguration.deadLetterQueueName!
      ]) {
        const purgeChannel = await connection.createChannel()
        purgeChannel.on('error', () => undefined)
        await purgeChannel.purgeQueue(queueName).catch(() => undefined)
      }

      // A concurrency of 1 gives a prefetch of 1, so an unsettled poison message would block every message after it
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(
          handlerFor(TestCommand, command => {
            handlerEvents.emit('received', command)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      channel.sendToQueue(
        poisonConfiguration.queueName,
        Buffer.from(poisonPayload),
        { messageId: randomUUID() }
      )
      const handled = new Promise<TestCommand>(resolve =>
        handlerEvents.once('received', resolve)
      )
      // The follow-up is sent on the bus' connection, so the broker may deliver it before the
      // poison message, and handling it says nothing about whether the poison was dead-lettered
      await bus.send(new TestCommand('after-poison'))
      ;[handledAfterPoison, deadLetter] = await Promise.all([
        handled,
        nextDeadLetter()
      ])
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should keep handling the messages after it', () => {
      expect(handledAfterPoison.value).toEqual('after-poison')
    })

    it('should send it to the dead letter queue unchanged', () => {
      expect(deadLetter.content.toString()).toEqual(poisonPayload)
    })

    it('should add the parse error to the failure metadata', () => {
      expect(
        fromFailureHeader(deadLetter.properties.headers?.[FAILURE_HEADER])
      ).toMatchObject({
        error: { name: 'SyntaxError' },
        failedAttempts: 1,
        endpoint: poisonConfiguration.queueName
      })
    })

    it('should remove it from the service queue', async () => {
      const { messageCount } = await channel.checkQueue(
        poisonConfiguration.queueName
      )
      expect(messageCount).toEqual(0)
    })
  })

  describe('with a recoverability policy', () => {
    const MAX_ATTEMPTS = 3
    const retryConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-retry-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-retry-test-dead-letter',
      connectionString: configuration.connectionString
    }
    const sut = new RabbitMqTransport(retryConfiguration)
    const handlerEvents = new EventEmitter()
    /**
     * When each command was handled, by value
     */
    const handlings = new Map<string, number[]>()
    /**
     * The AMQP headers of each delivery, by command value
     */
    const deliveryHeaders = new Map<string, Record<string, unknown>[]>()
    /**
     * The failed attempts the policy was called with
     */
    let retryAttempts: number[] = []
    /**
     * The delays the policy retries with, in the order it's called
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
      return {
        command: JSON.parse(
          rabbitMessage.content.toString()
        ) as TestRetryCommand,
        headers: rabbitMessage.properties.headers ?? {}
      }
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
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withConcurrency(2)
        .withRecoverability(({ failedAttempts }) => {
          retryAttempts.push(failedAttempts)
          return failedAttempts >= MAX_ATTEMPTS
            ? deadLetter()
            : retry(retryDelays.shift() ?? 0)
        })
        .withHandler(
          handlerFor(TestRetryCommand, async (command, _attributes, ctx) => {
            const times = handlings.get(command.value) ?? []
            times.push(Date.now())
            handlings.set(command.value, times)
            const raw = bus.getHandlingContext()!.raw as ConsumeMessage
            deliveryHeaders.set(command.value, [
              ...(deliveryHeaders.get(command.value) ?? []),
              { ...raw.properties.headers }
            ])
            handlerEvents.emit('received', command)
            if (command.value === 'fail-then-throw') {
              await ctx.failMessage()
              throw new Error('Thrown after failMessage')
            }
            if (command.value === 'return-then-throw' && times.length === 1) {
              await ctx.returnMessage()
              throw new Error('Thrown after returnMessage')
            }
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

      it('should pass the number of failed attempts to the policy', () => {
        expect(retryAttempts).toEqual([1])
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
      let deadLetterHeaders: Record<string, unknown>

      beforeAll(async () => {
        retryAttempts = []
        retryDelays = [10, 10, 10]
        await bus.send(new TestRetryCommand('poisoned', 100))
        ;({ command: deadLetter, headers: deadLetterHeaders } =
          await readFromDeadLetterQueue())
      })

      it('should leave the attempt count off the dead-lettered message, so it can be replayed', () => {
        expect(deadLetterHeaders).not.toHaveProperty('failedAttempts')
        expect(
          fromFailureHeader(deadLetterHeaders[FAILURE_HEADER])
        ).toMatchObject({ failedAttempts: MAX_ATTEMPTS })
      })

      it('should retry until the policy dead-letters it', () => {
        expect(deadLetter.value).toEqual('poisoned')
        expect(handlings.get('poisoned')).toHaveLength(MAX_ATTEMPTS)
      })

      it('should count each failed attempt', () => {
        expect(retryAttempts).toEqual([1, 2, 3])
      })
    })

    describe('when a handler fails a message and then throws', () => {
      let deadLetter: TestRetryCommand
      let deadLetterQueueDepth: number

      beforeAll(async () => {
        await bus.send(new TestRetryCommand('fail-then-throw', 0))
        ;({ command: deadLetter } = await readFromDeadLetterQueue())
        // Long enough for a retry to come back if it had been returned as well
        await sleep(500)
        ;({ messageCount: deadLetterQueueDepth } = await channel.checkQueue(
          retryConfiguration.deadLetterQueueName!
        ))
      })

      it('should dead-letter it once', () => {
        expect(deadLetter.value).toEqual('fail-then-throw')
        expect(deadLetterQueueDepth).toEqual(0)
      })

      it('should not retry it', () => {
        expect(handlings.get('fail-then-throw')).toHaveLength(1)
      })
    })

    describe('when a handler returns a message and then throws', () => {
      beforeAll(async () => {
        const retried = handled('return-then-throw', 2)
        await bus.send(new TestRetryCommand('return-then-throw', 0))
        await retried
        // Long enough for a second copy to arrive if it had been returned twice
        await sleep(500)
      })

      it('should return it once', () => {
        expect(handlings.get('return-then-throw')).toHaveLength(2)
      })
    })

    describe('when a replayed dead letter fails again', () => {
      beforeAll(async () => {
        const retried = handled('replayed', 2)
        // As a shovel would move it back from the dead letter queue, with the failure metadata of its last failure
        channel.publish(
          TestRetryCommand.NAME,
          '',
          Buffer.from(JSON.stringify(new TestRetryCommand('replayed', 1))),
          {
            messageId: randomUUID(),
            headers: { [FAILURE_HEADER]: '{"failedAttempts":10}' }
          }
        )
        await retried
      })

      it('should not carry the stale failure metadata on the retry', () => {
        const [firstDelivery, retry] = deliveryHeaders.get('replayed')!
        expect(firstDelivery).toHaveProperty(FAILURE_HEADER)
        expect(retry).not.toHaveProperty(FAILURE_HEADER)
      })
    })
  })

  describe('with outgoing middleware that sets headers', () => {
    const headersConfiguration: RabbitMqTransportConfiguration = {
      queueName: '@node-ts/bus-rabbitmq-headers-test',
      deadLetterQueueName: '@node-ts/bus-rabbitmq-headers-test-dead-letter',
      connectionString: configuration.connectionString
    }
    const sut = new RabbitMqTransport(headersConfiguration)
    const handlerEvents = new EventEmitter()
    /**
     * The AMQP headers of each delivery of the command, in the order they were received
     */
    const receivedHeaders: Record<string, unknown>[] = []
    let deadLetterHeaders: Record<string, unknown>
    let bus: BusInstance
    let reservedHeaderError: unknown

    const readFromDeadLetterQueue = async () => {
      const deadLetterChannel = await connection.createChannel()
      const rabbitMessage = await new Promise<ConsumeMessage>(
        (resolve, reject) => {
          deadLetterChannel
            .consume(headersConfiguration.deadLetterQueueName!, message => {
              deadLetterChannel.ack(message!)
              resolve(message!)
            })
            .catch(reject)
        }
      )
      await deadLetterChannel.close()
      return rabbitMessage
    }

    beforeAll(async () => {
      for (const queueName of [
        headersConfiguration.queueName,
        headersConfiguration.deadLetterQueueName!
      ]) {
        const purgeChannel = await connection.createChannel()
        purgeChannel.on('error', () => undefined)
        await purgeChannel.purgeQueue(queueName).catch(() => undefined)
      }

      let attempts = 0
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withRecoverability(() => retry(0))
        .withMiddleware({
          outgoing: async (context, next) => {
            const command = context.message as TestRetryCommand
            if (command.value === 'reserved') {
              context.headers.failedAttempts = 5
            } else {
              context.headers['x-tenant'] = 'acme'
              context.headers['x-priority'] = 3
              context.headers['x-urgent'] = true
            }
            await next()
          },
          incoming: async (context, next) => {
            const raw = context.transportMessage.raw as ConsumeMessage
            if ((context.message as TestRetryCommand).value === 'headers') {
              receivedHeaders.push({ ...raw.properties.headers })
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestRetryCommand, async (command, _attributes, ctx) => {
            if (command.value === 'dead-letter') {
              await ctx.failMessage()
              return
            }
            handlerEvents.emit('received')
            if (++attempts === 1) {
              throw new Error(
                'Fail the first attempt so the message is retried'
              )
            }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      reservedHeaderError = await bus
        .send(new TestRetryCommand('reserved', 0))
        .catch(error => error)

      const retried = new Promise<void>(resolve => {
        let received = 0
        handlerEvents.on('received', () => {
          if (++received === 2) {
            resolve()
          }
        })
      })
      await bus.send(new TestRetryCommand('headers', 1))
      await retried

      const deadLettered = readFromDeadLetterQueue()
      await bus.send(new TestRetryCommand('dead-letter', 0))
      deadLetterHeaders = (await deadLettered).properties.headers ?? {}
    })

    afterAll(async () => {
      await bus.dispose()
      await channel.deleteExchange(TestRetryCommand.NAME)
    })

    it('should write the headers as AMQP headers', () => {
      expect(receivedHeaders[0]).toMatchObject({
        'x-tenant': 'acme',
        'x-priority': 3,
        'x-urgent': true
      })
    })

    it('should keep the headers when the message is retried', () => {
      expect(receivedHeaders).toHaveLength(2)
      expect(receivedHeaders[1]).toMatchObject({
        'x-tenant': 'acme',
        'x-priority': 3,
        'x-urgent': true,
        failedAttempts: 1
      })
    })

    it('should keep the headers when the message is failed to the dead letter queue', () => {
      expect(deadLetterHeaders).toMatchObject({
        'x-tenant': 'acme',
        'x-priority': 3,
        'x-urgent': true
      })
    })

    it('should add the failure metadata to the dead-lettered message', () => {
      expect(
        fromFailureHeader(deadLetterHeaders[FAILURE_HEADER])
      ).toMatchObject({
        error: { name: 'FailMessageRequested' },
        failedAttempts: 1,
        endpoint: headersConfiguration.queueName
      })
    })

    it('should throw TransportHeaderReserved for a header the transport writes itself', () => {
      expect(reservedHeaderError).toBeInstanceOf(TransportHeaderReserved)
      expect(reservedHeaderError).toMatchObject({
        headerName: 'failedAttempts',
        transportName: 'RabbitMqTransport'
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
