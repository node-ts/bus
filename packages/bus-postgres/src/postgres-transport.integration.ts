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
  MessageFailure,
  MessageSerializer,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  retry
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import {
  messageTypes,
  TestCommand,
  TestOutboxCommand,
  TestOutboxEvent,
  TestSystemMessage,
  transportTests
} from '@node-ts/bus-test'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { Pool } from 'pg'
import { Mock } from 'typemoq'
import { PostgresPersistence } from './postgres-persistence'
import { PostgresTransport } from './postgres-transport'
import { PostgresTransportConfiguration } from './postgres-transport-configuration'

jest.setTimeout(30_000)

const connection = {
  connectionString:
    process.env.POSTGRES_URL ||
    'postgres://postgres:password@localhost:6432/postgres'
}

const TRANSPORT_SCHEMA = 'transport_tests'
const UNPROVISIONED_SCHEMA = 'transport_unprovisioned'
const DRY_RUN_SCHEMA = 'transport_dry_run'
const RECEIVING_SCHEMA = 'transport_receiving'
const OUTBOX_SCHEMA = 'transport_outbox'

const TEST_SCHEMAS = [
  TRANSPORT_SCHEMA,
  UNPROVISIONED_SCHEMA,
  DRY_RUN_SCHEMA,
  RECEIVING_SCHEMA,
  OUTBOX_SCHEMA
]

const configuration: PostgresTransportConfiguration = {
  queueName: '@node-ts/bus-postgres-transport-test',
  schemaName: TRANSPORT_SCHEMA,
  connection
}

const silentLogger = () => Mock.ofType<Logger>().object

/**
 * Moves a queue's dead letters back to it, as the docs show
 */
const redriveSql = (schemaName: string) => `
  with redriven as (
    delete from "${schemaName}".transport_dead_letters
    where queue = $1
    returning queue, body, attributes, headers
  )
  insert into "${schemaName}".transport_messages (queue, body, attributes, headers, visible_at)
  select queue, body, attributes, headers - 'bus-failure', now()
  from redriven;`

describe('PostgresTransport', () => {
  const postgres = new Pool(connection)
  const transport = new PostgresTransport(configuration)
  const messageSerializer = new MessageSerializer(
    new JsonSerializer(),
    new DefaultHandlerRegistry(),
    { messages: {}, types: {} }
  )

  const publishSystemMessage = async (systemMessage: string) => {
    await postgres.query(
      `
      insert into "${TRANSPORT_SCHEMA}".transport_messages (queue, body, attributes, headers, visible_at)
      select queue, $2, $3, '{}', now()
      from "${TRANSPORT_SCHEMA}".transport_subscriptions
      where message_name = $1;`,
      [
        TestSystemMessage.NAME,
        JSON.stringify(new TestSystemMessage()),
        JSON.stringify({
          messageId: randomUUID(),
          attributes: { systemMessage },
          stickyAttributes: {}
        })
      ]
    )
  }

  const readAllFromDeadLetterQueue = async () => {
    // Wait for a message to arrive, to give the handler time to fail it
    while (true) {
      const { rowCount } = await postgres.query(
        `select 1 from "${TRANSPORT_SCHEMA}".transport_dead_letters where queue = $1;`,
        [configuration.queueName]
      )
      if (rowCount) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const { rows } = await postgres.query(
      `delete from "${TRANSPORT_SCHEMA}".transport_dead_letters where queue = $1 returning body, attributes, headers;`,
      [configuration.queueName]
    )
    return (
      rows as {
        body: string
        attributes: MessageAttributes
        headers: Record<string, unknown>
      }[]
    ).map(row => ({
      message: messageSerializer.deserialize(row.body) as Message,
      attributes: row.attributes,
      failure: fromFailureHeader(row.headers[FAILURE_HEADER])
    }))
  }

  beforeAll(async () => {
    for (const schema of TEST_SCHEMAS) {
      await postgres.query(`drop schema if exists "${schema}" cascade;`)
    }
  })

  afterAll(async () => postgres.end())

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
    let error: unknown

    beforeAll(async () => {
      const bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(
          new PostgresTransport({
            ...configuration,
            schemaName: UNPROVISIONED_SCHEMA
          })
        )
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      try {
        await bus.initialize()
      } catch (e) {
        error = e
      }
      await bus.dispose()
    })

    it('should fail with ResourcesNotProvisioned, naming the missing schema', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).missingResources).toEqual([
        `Postgres schema "${UNPROVISIONED_SCHEMA}"`
      ])
    })

    describe('and only its tables have been provisioned', () => {
      let tablesOnlyError: unknown

      beforeAll(async () => {
        // A send-only bus provisions the tables, but no queue or subscriptions
        const sendOnlyBus = Bus.configure()
          .withLogger(silentLogger)
          .withTransport(
            new PostgresTransport({
              ...configuration,
              schemaName: UNPROVISIONED_SCHEMA
            })
          )
          .asSendOnly()
          .build()
        await sendOnlyBus.provision()
        await sendOnlyBus.dispose()

        const bus = Bus.configure()
          .withLogger(silentLogger)
          .withMessageTypes(messageTypes)
          .withTransport(
            new PostgresTransport({
              ...configuration,
              schemaName: UNPROVISIONED_SCHEMA
            })
          )
          .withHandler(handlerFor(TestCommand, () => undefined))
          .build()
        try {
          await bus.initialize()
        } catch (e) {
          tablesOnlyError = e
        }
        await bus.dispose()
      })

      it('should name the missing queue and subscription', () => {
        expect(tablesOnlyError).toBeInstanceOf(ResourcesNotProvisioned)
        expect(
          (tablesOnlyError as ResourcesNotProvisioned).missingResources
        ).toEqual([
          `Postgres transport queue ${configuration.queueName}`,
          `Postgres transport subscription ${TestCommand.NAME} -> ${configuration.queueName}`
        ])
      })
    })
  })

  describe('when provisioning as a dry run', () => {
    let plan: ProvisioningPlan[]
    let schemaExists: boolean

    beforeAll(async () => {
      const bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(
          new PostgresTransport({
            ...configuration,
            schemaName: DRY_RUN_SCHEMA
          })
        )
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      plan = await bus.provision({ dryRun: true })
      await bus.dispose()
      const { rowCount } = await postgres.query(
        'select 1 from pg_namespace where nspname = $1;',
        [DRY_RUN_SCHEMA]
      )
      schemaExists = rowCount === 1
    })

    it('should create nothing', () => {
      expect(schemaExists).toEqual(false)
    })

    it('should plan the queue and its subscription', () => {
      const transportPlan = plan.find(
        ({ adapter }) => adapter === 'PostgresTransport'
      )!
      expect(transportPlan.resources).toEqual(
        expect.arrayContaining([
          {
            type: 'postgres-transport-queue',
            name: configuration.queueName
          },
          {
            type: 'postgres-transport-subscription',
            name: `${TestCommand.NAME} -> ${configuration.queueName}`,
            properties: {
              messageName: TestCommand.NAME,
              queue: configuration.queueName
            }
          }
        ])
      )
    })

    it('should list the grants the transport needs at runtime', () => {
      const transportPlan = plan.find(
        ({ adapter }) => adapter === 'PostgresTransport'
      )!
      expect(transportPlan.runtimePermissions).toEqual({
        format: 'sql',
        document: [
          `GRANT USAGE ON SCHEMA "${DRY_RUN_SCHEMA}" TO <runtime_role>;`,
          `GRANT SELECT, INSERT, UPDATE, DELETE ON "${DRY_RUN_SCHEMA}"."transport_messages" TO <runtime_role>;`,
          `GRANT SELECT ON "${DRY_RUN_SCHEMA}"."transport_queues" TO <runtime_role>;`,
          `GRANT SELECT ON "${DRY_RUN_SCHEMA}"."transport_subscriptions" TO <runtime_role>;`,
          `GRANT INSERT ON "${DRY_RUN_SCHEMA}"."transport_dead_letters" TO <runtime_role>;`
        ]
      })
    })
  })

  describe('when receiving', () => {
    const queueName = 'transport-receiving'
    const events = new EventEmitter()
    const buses: BusInstance[] = []

    /**
     * The failed attempts of each receipt of a message, in the order they arrived
     */
    let receipts: number[] = []

    const buildBus = async (
      transportConfiguration: Partial<PostgresTransportConfiguration>,
      handle: (command: TestCommand) => Promise<void>,
      concurrency = 1
    ) => {
      receipts = []
      const bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(
          new PostgresTransport({
            ...configuration,
            queueName,
            schemaName: RECEIVING_SCHEMA,
            ...transportConfiguration
          })
        )
        .withConcurrency(concurrency)
        .withAutoProvision()
        .withMiddleware({
          incoming: async (context, next) => {
            receipts.push(context.transportMessage.failedAttempts)
            await next()
          }
        })
        .withHandler(handlerFor(TestCommand, async command => handle(command)))
        .build()
      buses.push(bus)
      await bus.initialize()
      await bus.start()
      return bus
    }

    afterEach(async () => {
      while (buses.length) {
        await buses.pop()!.dispose()
      }
    })

    describe('and a notification arrives before the next poll', () => {
      it('should receive the message straight away', async () => {
        const bus = await buildBus(
          { pollIntervalMs: 60_000 },
          async command => {
            events.emit('listened', command.value)
          }
        )
        const value = randomUUID()
        const received = once(events, 'listened')
        await bus.send(new TestCommand(value, new Date()))
        expect(await received).toEqual([value])
      })
    })

    describe('and listening is off', () => {
      it('should receive the message on the next poll', async () => {
        const bus = await buildBus(
          { listen: false, pollIntervalMs: 100 },
          async command => {
            events.emit('polled', command.value)
          }
        )
        const value = randomUUID()
        const received = once(events, 'polled')
        await bus.send(new TestCommand(value, new Date()))
        expect(await received).toEqual([value])
      })
    })

    describe('and a message is not settled before its visibility timeout ends', () => {
      it('should receive it again, counting the expired receipt as a failed attempt', async () => {
        const secondReceipt = Promise.withResolvers<void>()
        const handled = Promise.withResolvers<void>()
        const bus = await buildBus(
          { visibilityTimeoutMs: 200, pollIntervalMs: 50 },
          async () => {
            if (receipts.length === 1) {
              // Still handling the first receipt when the second arrives
              await secondReceipt.promise
              handled.resolve()
            } else {
              secondReceipt.resolve()
            }
          },
          2
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await handled.promise
        expect(receipts).toEqual([0, 1])
      })
    })

    describe('and a message cannot be parsed', () => {
      it('should move it to the dead letter table with the parse error', async () => {
        await buildBus({}, async () => undefined)
        const { rows } = await postgres.query(
          `
          insert into "${RECEIVING_SCHEMA}".transport_messages (queue, body, attributes, headers, visible_at)
          values ($1, 'not json', '{}', '{}', now())
          returning id;`,
          [queueName]
        )
        const id = (rows as { id: string }[])[0].id
        let failure: MessageFailure | undefined
        while (!failure) {
          const deadLetters = await postgres.query(
            `select headers from "${RECEIVING_SCHEMA}".transport_dead_letters where queue = $1 and body = 'not json';`,
            [queueName]
          )
          failure = fromFailureHeader(
            (deadLetters.rows as { headers: Record<string, unknown> }[])[0]
              ?.headers[FAILURE_HEADER]
          )
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        const remaining = await postgres.query(
          `select 1 from "${RECEIVING_SCHEMA}".transport_messages where id = $1;`,
          [id]
        )
        expect(remaining.rowCount).toEqual(0)
        expect(failure.failedAttempts).toEqual(1)
        expect(failure.endpoint).toEqual(queueName)
      })
    })
  })

  describe('with withOutbox() on the same database', () => {
    const queueName = 'transport-outbox'
    const events = new EventEmitter()
    const received: TestOutboxEvent[] = []
    const handledRunIds: string[] = []
    const redrivenRunIds = new Set<string>()
    let bus: BusInstance

    const receivedFrom = (runId: string) =>
      received.filter(event => event.runId === runId)

    const waitForEvent = async (runId: string): Promise<void> =>
      new Promise(resolve => {
        const listener = (receivedRunId: string) => {
          if (receivedRunId === runId) {
            events.off('received', listener)
            resolve()
          }
        }
        events.on('received', listener)
      })

    /**
     * Sends a command and waits for the event its handler publishes, so every message sent before it has been
     * handled, since the bus handles one message at a time in the order they were sent
     */
    const drain = async (): Promise<void> => {
      const runId = randomUUID()
      const eventReceived = waitForEvent(runId)
      await bus.send(new TestOutboxCommand(runId, 'publish'))
      await eventReceived
    }

    beforeAll(async () => {
      const outboxConfiguration = {
        connection,
        schemaName: OUTBOX_SCHEMA
      }
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypes)
        .withTransport(
          new PostgresTransport({
            ...outboxConfiguration,
            queueName,
            pollIntervalMs: 100
          })
        )
        .withPersistence(new PostgresPersistence(outboxConfiguration))
        .withOutbox()
        .withAutoProvision()
        .withRecoverability(({ message, failedAttempts }) => {
          if (failedAttempts < 2) {
            return retry(0)
          }
          events.emit('dead-lettered', (message as TestOutboxCommand).runId)
          return deadLetter()
        })
        .withHandler(
          handlerFor(TestOutboxCommand, async ({ runId, scenario }, _, ctx) => {
            handledRunIds.push(runId)
            await ctx.publish(new TestOutboxEvent(runId, scenario))
            if (scenario === 'fail' && !redrivenRunIds.has(runId)) {
              throw new Error('Handler failed')
            }
          })
        )
        .withHandler(
          handlerFor(TestOutboxEvent, event => {
            received.push(event)
            events.emit('received', event.runId)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    describe('when a handler publishes an event', () => {
      it('should deliver the event once its transaction is committed', async () => {
        const runId = randomUUID()
        const eventReceived = waitForEvent(runId)
        await bus.send(new TestOutboxCommand(runId, 'publish'))
        await eventReceived
        expect(receivedFrom(runId)).toHaveLength(1)
      })
    })

    describe('when a handler fails after publishing an event', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        const deadLettered = once(events, 'dead-lettered')
        await bus.send(new TestOutboxCommand(runId, 'fail'))
        await deadLettered
        await drain()
      })

      it('should not deliver the event', () => {
        expect(receivedFrom(runId)).toHaveLength(0)
      })

      describe('and its dead letter is moved back to the queue', () => {
        beforeAll(async () => {
          redrivenRunIds.add(runId)
          const eventReceived = waitForEvent(runId)
          await postgres.query(redriveSql(OUTBOX_SCHEMA), [queueName])
          await eventReceived
        })

        it('should handle it again', () => {
          expect(receivedFrom(runId)).toHaveLength(1)
        })
      })
    })

    describe('when a message is delivered twice', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        const messageId = randomUUID()
        const command = new TestOutboxCommand(runId, 'publish')
        await bus.send(command, { messageId })
        await bus.send(command, { messageId })
        await drain()
      })

      it('should handle it once', () => {
        expect(handledRunIds.filter(id => id === runId)).toHaveLength(1)
        expect(receivedFrom(runId)).toHaveLength(1)
      })
    })

    describe('when a message is sent with a delay', () => {
      const delay = 500
      let elapsed: number

      beforeAll(async () => {
        const runId = randomUUID()
        const eventReceived = waitForEvent(runId)
        const sentAt = Date.now()
        await bus.send(new TestOutboxCommand(runId, 'publish'), {
          deliverAfter: delay
        })
        await eventReceived
        elapsed = Date.now() - sentAt
      })

      it('should deliver it once the delay has passed', () => {
        expect(elapsed).toBeGreaterThanOrEqual(delay)
      })
    })
  })
})
