import {
  Bus,
  BusInstance,
  deadLetter,
  DefaultHandlerRegistry,
  EndpointNotFound,
  FAILURE_HEADER,
  fromFailureHeader,
  handlerFor,
  JsonSerializer,
  Logger,
  MessageFailure,
  MessageSerializer,
  ProvisioningPlan,
  RecoverabilityPolicy,
  ResourcesNotProvisioned,
  retry
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import {
  messageTypes,
  TestCommand,
  TestSystemMessage,
  transportTests
} from '@node-ts/bus-test'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createClient } from 'redis'
import { Mock } from 'typemoq'
import { RedisTransport } from './redis-transport'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import { FreezableProxy } from './test'

jest.setTimeout(30_000)

const connection = {
  url: process.env.REDIS_URL || 'redis://localhost:6380'
}

// Every key this run makes starts with it, so the run only ever touches its own keys
const keyPrefix = `node-ts-bus-test-${randomUUID()}`

const configuration: RedisTransportConfiguration = {
  queueName: '@node-ts/bus-redis-transport-test',
  keyPrefix,
  connection
}

const silentLogger = () => Mock.ofType<Logger>().object

/**
 * Moves a queue's dead letters back to it, as the docs show
 */
const REDRIVE_SCRIPT = `
local entries = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', 1000)
for _, entry in ipairs(entries) do
  local fields = {}
  for i = 1, #entry[2], 2 do
    if entry[2][i] ~= 'bus-failure' then
      fields[#fields + 1] = entry[2][i]
      fields[#fields + 1] = entry[2][i + 1]
    end
  end
  redis.call('XADD', KEYS[2], '*', unpack(fields))
  redis.call('XDEL', KEYS[1], entry[1])
end
return #entries
`

/**
 * Turns a stream entry's fields and values, one after the other, into an object
 */
const toFields = (values: string[]): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (let i = 0; i < values.length; i += 2) {
    fields[values[i]] = values[i + 1]
  }
  return fields
}

describe('RedisTransport', () => {
  const redis = createClient({ ...connection, RESP: 2 })
  const transport = new RedisTransport(configuration)
  const messageSerializer = new MessageSerializer(
    new JsonSerializer(),
    new DefaultHandlerRegistry(),
    { messages: {}, types: {} }
  )
  const queueKey = (queueName: string) => `${keyPrefix}:{${queueName}}:queue`
  const deadLetterKey = (queueName: string) =>
    `${keyPrefix}:{${queueName}}:dead-letter`

  const publishSystemMessage = async (systemMessage: string) => {
    const queues = await redis.sendCommand<string[]>([
      'SMEMBERS',
      `${keyPrefix}:subscriptions:${TestSystemMessage.NAME}`
    ])
    for (const queue of queues) {
      await redis.sendCommand([
        'XADD',
        queueKey(queue),
        '*',
        'body',
        JSON.stringify(new TestSystemMessage()),
        'attributes',
        JSON.stringify({
          messageId: randomUUID(),
          attributes: { systemMessage },
          stickyAttributes: {}
        }),
        'headers',
        '{}'
      ])
    }
  }

  /**
   * Waits for a dead letter in a queue's dead letter stream, then reads and removes them all
   */
  const takeDeadLetters = async (queueName: string) => {
    const key = deadLetterKey(queueName)
    while ((await redis.sendCommand<number>(['XLEN', key])) === 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const entries = await redis.sendCommand<[string, string[]][]>([
      'XRANGE',
      key,
      '-',
      '+'
    ])
    await redis.sendCommand(['XDEL', key, ...entries.map(([id]) => id)])
    return entries.map(([, values]) => toFields(values))
  }

  const readAllFromDeadLetterQueue = async () =>
    (await takeDeadLetters(configuration.queueName)).map(fields => ({
      message: messageSerializer.deserialize(fields.body) as Message,
      attributes: JSON.parse(fields.attributes) as MessageAttributes,
      failure: fromFailureHeader(fields[FAILURE_HEADER])
    }))

  beforeAll(async () => {
    await redis.connect()
  })

  afterAll(async () => {
    // Removes only this run's keys. Never FLUSHDB: the server may be shared.
    let cursor = '0'
    do {
      const [next, keys] = await redis.sendCommand<[string, string[]]>([
        'SCAN',
        cursor,
        'MATCH',
        `${keyPrefix}:*`,
        'COUNT',
        '1000'
      ])
      cursor = next
      if (keys.length) {
        await redis.sendCommand(['UNLINK', ...keys])
      }
    } while (cursor !== '0')
    await redis.close()
  })

  transportTests(
    transport,
    publishSystemMessage,
    TestSystemMessage.NAME,
    readAllFromDeadLetterQueue
  )

  describe('when reading the endpoint name', () => {
    it('should be the queue name', () => {
      expect(transport.endpointName).toEqual(configuration.queueName)
    })
  })

  describe('when a bus initializes before its resources are provisioned', () => {
    const queueName = 'unprovisioned'
    let error: unknown

    beforeAll(async () => {
      const bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(new RedisTransport({ ...configuration, queueName }))
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      try {
        await bus.initialize()
      } catch (e) {
        error = e
      }
      await bus.dispose()
    })

    it('should fail with ResourcesNotProvisioned, naming the missing stream, group and subscription', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).missingResources).toEqual([
        `Redis stream ${queueKey(queueName)}`,
        `Redis consumer group ${queueName} on ${queueKey(queueName)}`,
        `Redis subscription ${TestCommand.NAME} -> ${queueName}`
      ])
    })
  })

  describe('when provisioning as a dry run', () => {
    const queueName = 'dry-run'
    let plan: ProvisioningPlan[]
    let streamExists: number

    beforeAll(async () => {
      const bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(new RedisTransport({ ...configuration, queueName }))
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      plan = await bus.provision({ dryRun: true })
      await bus.dispose()
      streamExists = await redis.sendCommand<number>([
        'EXISTS',
        queueKey(queueName)
      ])
    })

    it('should create nothing', () => {
      expect(streamExists).toEqual(0)
    })

    it('should plan the stream, consumer group and subscription', () => {
      const transportPlan = plan.find(
        ({ adapter }) => adapter === 'RedisTransport'
      )!
      expect(transportPlan.resources).toEqual(
        expect.arrayContaining([
          {
            type: 'redis-consumer-group',
            name: queueName,
            properties: { stream: queueKey(queueName), startId: '0' }
          },
          {
            type: 'redis-subscription',
            name: `${TestCommand.NAME} -> ${queueName}`,
            properties: {
              set: `${keyPrefix}:subscriptions:${TestCommand.NAME}`,
              member: queueName
            }
          }
        ])
      )
    })
  })

  describe('when provisioning twice', () => {
    it('should succeed both times', async () => {
      const queueName = 'provisioned-twice'
      for (let i = 0; i < 2; i++) {
        const bus = Bus.configure()
          .withLogger(silentLogger)
          .withMessageTypes(messageTypes)
          .withTransport(new RedisTransport({ ...configuration, queueName }))
          .withHandler(handlerFor(TestCommand, () => undefined))
          .build()
        await bus.provision()
        await bus.dispose()
      }
    })
  })

  describe('when receiving', () => {
    /**
     * Builds, initializes and starts a bus with its own queue, which records the failed attempts and time of each
     * receipt
     */
    const startBus = async (
      queueName: string,
      transportConfiguration: Partial<RedisTransportConfiguration>,
      handle: (command: TestCommand) => Promise<void>,
      options: {
        concurrency?: number
        receipts?: { failedAttempts: number; at: number }[]
        recoverability?: RecoverabilityPolicy
      } = {}
    ): Promise<BusInstance> => {
      const configure = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(
          new RedisTransport({
            ...configuration,
            queueName,
            ...transportConfiguration
          })
        )
        .withConcurrency(options.concurrency ?? 1)
        .withAutoProvision()
        .withMiddleware({
          incoming: async (context, next) => {
            options.receipts?.push({
              failedAttempts: context.transportMessage.failedAttempts,
              at: Date.now()
            })
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, async command => handle(command)))
      if (options.recoverability) {
        configure.withRecoverability(options.recoverability)
      }
      const bus = configure.build()
      await bus.initialize()
      await bus.start()
      return bus
    }

    describe('and a message is not settled before its visibility timeout ends', () => {
      const receipts: { failedAttempts: number; at: number }[] = []
      let bus: BusInstance
      let pending: number

      beforeAll(async () => {
        const queueName = 'visibility-timeout'
        const secondReceipt = Promise.withResolvers<void>()
        const firstHandled = Promise.withResolvers<void>()
        bus = await startBus(
          queueName,
          { visibilityTimeoutMs: 200 },
          async () => {
            if (receipts.length === 1) {
              // Still handling the first receipt when the second arrives
              await secondReceipt.promise
              firstHandled.resolve()
            } else {
              secondReceipt.resolve()
            }
          },
          { concurrency: 2, receipts }
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await firstHandled.promise
        // The second receipt deleted it. The first receipt's delete settles nothing, since it was taken over.
        while (
          (await redis.sendCommand<number>(['XLEN', queueKey(queueName)])) > 0
        ) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        const [count] = await redis.sendCommand<[number]>([
          'XPENDING',
          queueKey(queueName),
          queueName
        ])
        pending = count
      })

      afterAll(async () => bus.dispose())

      it('should receive it again, counting the expired receipt as a failed attempt', () => {
        expect(receipts.map(({ failedAttempts }) => failedAttempts)).toEqual([
          0, 1
        ])
      })

      it('should leave nothing pending', () => {
        expect(pending).toEqual(0)
      })
    })

    describe('and a message is returned with a delay', () => {
      const RETRY_DELAY = 1_500
      const receipts: { failedAttempts: number; at: number }[] = []
      let bus: BusInstance

      beforeAll(async () => {
        const handledTwice = Promise.withResolvers<void>()
        bus = await startBus(
          'returned-with-delay',
          {},
          async () => {
            if (receipts.length === 1) {
              throw new Error('Fails the first time')
            }
            handledTwice.resolve()
          },
          { receipts, recoverability: () => retry(RETRY_DELAY) }
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await handledTwice.promise
      })

      afterAll(async () => bus.dispose())

      it('should receive it again once the delay has passed', () => {
        expect(receipts[1].at - receipts[0].at).toBeGreaterThanOrEqual(
          RETRY_DELAY - 50
        )
      })

      it('should count the failed attempt', () => {
        expect(receipts.map(({ failedAttempts }) => failedAttempts)).toEqual([
          0, 1
        ])
      })
    })

    describe('and the bus is disposed once its messages are handled', () => {
      const queueName = 'leaves-group'
      let consumers: unknown[]

      beforeAll(async () => {
        const handled = Promise.withResolvers<void>()
        const bus = await startBus(queueName, {}, async () => handled.resolve())
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await handled.promise
        await bus.dispose()
        consumers = await redis.sendCommand<unknown[]>([
          'XINFO',
          'CONSUMERS',
          queueKey(queueName),
          queueName
        ])
      })

      it('should leave the consumer group', () => {
        expect(consumers).toEqual([])
      })
    })

    describe('and a dead-lettered message is moved back to the queue', () => {
      const queueName = 'redrive'
      const receipts: { failedAttempts: number; at: number }[] = []
      let bus: BusInstance
      let redriven: number

      beforeAll(async () => {
        const handled = Promise.withResolvers<void>()
        let fixed = false
        bus = await startBus(
          queueName,
          {},
          async () => {
            if (!fixed) {
              throw new Error('Fails until the cause is fixed')
            }
            handled.resolve()
          },
          { receipts, recoverability: () => deadLetter() }
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        // Waits for it to be dead-lettered, without removing it
        while (
          (await redis.sendCommand<number>([
            'XLEN',
            deadLetterKey(queueName)
          ])) === 0
        ) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        fixed = true
        redriven = await redis.sendCommand<number>([
          'EVAL',
          REDRIVE_SCRIPT,
          '2',
          deadLetterKey(queueName),
          queueKey(queueName)
        ])
        await handled.promise
      })

      afterAll(async () => bus.dispose())

      it('should move it with the script the docs show', () => {
        expect(redriven).toEqual(1)
      })

      it('should handle it again with all its attempts', () => {
        expect(receipts.map(({ failedAttempts }) => failedAttempts)).toEqual([
          0, 0
        ])
      })
    })

    describe('and Redis stops answering', () => {
      const proxy = new FreezableProxy({
        host: new URL(connection.url).hostname,
        port: Number(new URL(connection.url).port || 6379)
      })
      let stopMs: number
      let disposeMs: number

      beforeAll(async () => {
        await proxy.start()
        const handled = Promise.withResolvers<void>()
        const bus = await startBus(
          'frozen',
          {
            connection: {
              url: `redis://127.0.0.1:${proxy.port}`,
              name: 'node-ts-bus-test-frozen'
            }
          },
          async () => handled.resolve()
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await handled.promise
        // Freezes while the worker waits on the server for its next message, so that read is in flight
        while (
          !(await redis.sendCommand<string>(['CLIENT', 'LIST']))
            .split('\n')
            .some(
              client =>
                client.includes('name=node-ts-bus-test-frozen ') &&
                /cmd=xreadgroup/.test(client) &&
                /flags=b/.test(client)
            )
        ) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        proxy.freeze()
        const stopping = Date.now()
        await bus.stop()
        stopMs = Date.now() - stopping
        const disposing = Date.now()
        await bus.dispose()
        disposeMs = Date.now() - disposing
      })

      afterAll(async () => proxy.close())

      it('should stop without waiting for it', () => {
        // stop() gives a read in flight 3 s, then closes its connection
        expect(stopMs).toBeLessThan(8_000)
      })

      it('should dispose without waiting for it', () => {
        expect(disposeMs).toBeLessThan(10_000)
      })
    })

    describe('and Redis stops answering while messages are still being sent', () => {
      const proxy = new FreezableProxy({
        host: new URL(connection.url).hostname,
        port: Number(new URL(connection.url).port || 6379)
      })
      const handled = new EventEmitter()
      let bus: BusInstance | undefined
      let sending: NodeJS.Timeout | undefined
      let recovered: boolean
      let stopMs: number
      let disposeMs: number

      /**
       * Sends a message every 2 s, without waiting for it, as an API or a timer would. Each send writes to the
       * connection, so its socket timeout never ends, and only a check that Redis answers notices it's frozen.
       */
      const keepSending = (sender: BusInstance) =>
        setInterval(() => {
          sender
            .send(new TestCommand('sent-while-frozen', new Date()))
            .catch(() => undefined)
        }, 2_000)

      /**
       * Sends a message until it's handled, or the deadline passes. A connection made while Redis was frozen is stuck
       * until its socket timeout ends, so the first sends after it answers again may fail.
       */
      const receivesWithin = async (
        sender: BusInstance,
        ms: number
      ): Promise<boolean> => {
        const value = randomUUID()
        const deadline = Date.now() + ms
        while (Date.now() < deadline) {
          const received = new Promise<boolean>(resolve => {
            const onHandled = (handledValue: string) => {
              if (handledValue === value) {
                settle(true)
              }
            }
            const settle = (wasHandled: boolean) => {
              clearTimeout(timeout)
              handled.off('handled', onHandled)
              resolve(wasHandled)
            }
            const timeout = setTimeout(() => settle(false), 5_000)
            handled.on('handled', onHandled)
          })
          await sender
            .send(new TestCommand(value, new Date()))
            .catch(() => undefined)
          if (await received) {
            return true
          }
        }
        return false
      }

      beforeAll(async () => {
        await proxy.start()
        bus = await startBus(
          'frozen-while-sending',
          { connection: { url: `redis://127.0.0.1:${proxy.port}` } },
          async command => {
            handled.emit('handled', command.value)
          }
        )

        proxy.freeze()
        sending = keepSending(bus)
        // Long enough for the watchdog to send a PING (every 5 s) and give up waiting for its answer (15 s)
        await new Promise(resolve => setTimeout(resolve, 22_000))
        proxy.unfreeze()
        clearInterval(sending)
        recovered = await receivesWithin(bus, 45_000)

        proxy.freeze()
        sending = keepSending(bus)
        const stopping = Date.now()
        await bus.stop()
        stopMs = Date.now() - stopping
        const disposing = Date.now()
        await bus.dispose()
        disposeMs = Date.now() - disposing
        bus = undefined
      }, 120_000)

      afterAll(async () => {
        clearInterval(sending)
        await bus?.dispose()
        await proxy.close()
      })

      it('should replace the connections and receive again once Redis answers', () => {
        expect(recovered).toEqual(true)
      })

      it('should stop and dispose without waiting for it', () => {
        // The bus waits for the messages being handled, whose settling fails once the watchdog closes the connection
        // (a PING every 5 s, answered within 15 s)
        expect(stopMs).toBeLessThan(30_000)
        expect(disposeMs).toBeLessThan(10_000)
      })
    })

    describe('and a message cannot be parsed', () => {
      const queueName = 'unparseable'
      let bus: BusInstance
      let remaining: number
      let failure: MessageFailure | undefined

      beforeAll(async () => {
        bus = await startBus(queueName, {}, async () => undefined)
        await redis.sendCommand([
          'XADD',
          queueKey(queueName),
          '*',
          'body',
          'not json',
          'attributes',
          '{}',
          'headers',
          '{}'
        ])
        const [deadLetter] = await takeDeadLetters(queueName)
        failure = fromFailureHeader(deadLetter[FAILURE_HEADER])
        remaining = await redis.sendCommand<number>([
          'XLEN',
          queueKey(queueName)
        ])
      })

      afterAll(async () => bus.dispose())

      it('should remove it from the queue', () => {
        expect(remaining).toEqual(0)
      })

      it('should move it to the dead letter stream with the parse error', () => {
        expect(failure!.failedAttempts).toEqual(1)
        expect(failure!.endpoint).toEqual(queueName)
      })
    })
  })

  describe('when a message in a batch cannot be dead-lettered', () => {
    const queueName = 'batch-release'
    const transport = new RedisTransport({
      ...configuration,
      queueName,
      // Long, so a message left pending isn't taken over during the test
      visibilityTimeoutMs: 60_000
    })
    const ids: string[] = []
    let firstRound: PromiseSettledResult<unknown>[]
    let receivedAgain: { id: string; failedAttempts: number }[]
    let pending: [string, string, number, number][]

    beforeAll(async () => {
      await redis.sendCommand([
        'XGROUP',
        'CREATE',
        queueKey(queueName),
        queueName,
        '0',
        'MKSTREAM'
      ])
      // Its dead letter stream is a string, so dead-lettering fails every time
      await redis.sendCommand(['SET', deadLetterKey(queueName), 'not a stream'])
      for (const body of [
        JSON.stringify(new TestCommand('1', new Date())),
        'not json',
        JSON.stringify(new TestCommand('3', new Date())),
        JSON.stringify(new TestCommand('4', new Date()))
      ]) {
        ids.push(
          await redis.sendCommand<string>([
            'XADD',
            queueKey(queueName),
            '*',
            'body',
            body,
            'attributes',
            JSON.stringify({
              messageId: randomUUID(),
              attributes: {},
              stickyAttributes: {}
            }),
            'headers',
            '{}'
          ])
        )
      }
      transport.prepare({
        loggerFactory: silentLogger,
        messageSerializer
      } as never)
      await transport.connect()
      await transport.start()

      // Four reads waiting, so all four messages are read in one batch
      firstRound = await Promise.allSettled([
        transport.readNextMessage(),
        transport.readNextMessage(),
        transport.readNextMessage(),
        transport.readNextMessage()
      ])
      receivedAgain = []
      while (receivedAgain.length < 2) {
        const message = await transport.readNextMessage()
        if (message) {
          receivedAgain.push({
            id: message.id!,
            failedAttempts: message.failedAttempts
          })
          await transport.deleteMessage(message)
        }
      }
      pending = await redis.sendCommand<[string, string, number, number][]>([
        'XPENDING',
        queueKey(queueName),
        queueName,
        '-',
        '+',
        '10'
      ])
    })

    afterAll(async () => transport.dispose())

    it('should give the message before it to a read, and fail the other reads', () => {
      expect(
        firstRound.map(result =>
          result.status === 'fulfilled'
            ? (result.value as { id: string }).id
            : 'rejected'
        )
      ).toEqual([ids[0], 'rejected', 'rejected', 'rejected'])
    })

    it('should give back the messages after it straight away, without counting an attempt', () => {
      expect(receivedAgain).toEqual([
        { id: ids[2], failedAttempts: 0 },
        { id: ids[3], failedAttempts: 0 }
      ])
    })

    it('should leave the message that failed pending until its visibility timeout ends', () => {
      // The first message wasn't settled by the test, so it's pending too
      expect(pending.map(([id]) => id)).toEqual([ids[0], ids[1]])
    })
  })

  describe('when sending to an address with no queue', () => {
    let error: unknown

    beforeAll(async () => {
      const sender = new RedisTransport({
        ...configuration,
        queueName: 'address-sender'
      })
      sender.prepare({
        loggerFactory: silentLogger,
        messageSerializer
      } as never)
      await sender.connect()
      try {
        await sender.sendToAddress(
          'no-such-queue',
          new TestCommand(randomUUID(), new Date())
        )
      } catch (e) {
        error = e
      }
      await sender.dispose()
    })

    it('should throw EndpointNotFound', () => {
      expect(error).toBeInstanceOf(EndpointNotFound)
    })

    it('should not create a stream for it', async () => {
      expect(
        await redis.sendCommand<number>(['EXISTS', queueKey('no-such-queue')])
      ).toEqual(0)
    })
  })

  describe('when the bus runs as a user with only the runtime permissions in its plan', () => {
    const queueName = 'acl'
    const username = `node-ts-bus-test-${randomUUID()}`
    const password = randomUUID()
    const receipts: { failedAttempts: number; at: number }[] = []
    let deadLetters: Record<string, string>[]

    beforeAll(async () => {
      const busConfiguration = () =>
        Bus.configure()
          .withLogger(silentLogger)
          .withMessageTypes(messageTypes)
          .withHandler(
            handlerFor(TestCommand, async command => {
              receipts.push({ failedAttempts: 0, at: Date.now() })
              if (command.value === 'fail') {
                throw new Error('Fails every time')
              }
            })
          )
          .withRecoverability(({ failedAttempts }) =>
            failedAttempts < 2 ? retry(0) : deadLetter()
          )

      // Provisioned with the default user, as a deploy would
      const deploy = busConfiguration()
        .withTransport(new RedisTransport({ ...configuration, queueName }))
        .build()
      const [plan] = await deploy.provision()
      await deploy.dispose()
      const { rules } = plan.runtimePermissions!.document as {
        rules: string[]
      }
      await redis.sendCommand([
        'ACL',
        'SETUSER',
        username,
        'on',
        `>${password}`,
        'resetkeys',
        'resetchannels',
        '-@all',
        ...rules
      ])

      const bus = busConfiguration()
        .withTransport(
          new RedisTransport({
            ...configuration,
            queueName,
            connection: { ...connection, username, password }
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand('succeed', new Date()))
      await bus.send(new TestCommand('fail', new Date()))
      deadLetters = await takeDeadLetters(queueName)
      await bus.dispose()
    })

    afterAll(async () => {
      await redis.sendCommand(['ACL', 'DELUSER', username])
    })

    it('should receive, retry and dead-letter messages', () => {
      // One receipt of the message that succeeds, and two of the one that fails
      expect(receipts).toHaveLength(3)
      expect(deadLetters).toHaveLength(1)
      expect(fromFailureHeader(deadLetters[0][FAILURE_HEADER])).toMatchObject({
        failedAttempts: 2
      })
    })
  })
})
