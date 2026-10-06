import {
  Bus,
  BusInstance,
  deadLetter,
  handlerFor,
  InMemoryQueue,
  Logger,
  TransactionContext,
  TransactionNotActive,
  TransactionRolledBack
} from '@node-ts/bus-core'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { Pool } from 'pg'
import { It, Mock, Times } from 'typemoq'
import { messageTypes, RunTask, TaskRan, TestWorkflow } from '../test'
import { PostgresConfiguration } from './postgres-configuration'
import { PostgresPersistence } from './postgres-persistence'
import { postgresTransaction } from './postgres-transaction'

jest.setTimeout(20_000)

const schemaName = 'outbox_transaction'

const configuration: PostgresConfiguration = {
  connection: {
    connectionString:
      process.env.POSTGRES_URL ||
      'postgres://postgres:password@localhost:6432/postgres'
  },
  schemaName
}

const ordersTable = `"${schemaName}"."orders"`

describe('postgresTransaction', () => {
  const events = new EventEmitter()
  const deadLetterErrors = new Map<string, unknown>()
  let pool: Pool
  let bus: BusInstance

  /**
   * Resolves once `eventName` is emitted with a value
   */
  const waitFor = async (eventName: string, value: string): Promise<void> =>
    new Promise(resolve => {
      const listener = (emittedValue: string) => {
        if (emittedValue === value) {
          events.off(eventName, listener)
          resolve()
        }
      }
      events.on(eventName, listener)
    })

  const orderExists = async (orderId: string): Promise<boolean> => {
    const result = await pool.query(
      `select count(*) from ${ordersTable} where id = $1`,
      [orderId]
    )
    return (result.rows[0] as { count: string }).count === '1'
  }

  /**
   * Publishes an event outside a handler and waits for it, so every event published before it has been handled
   */
  const drainQueue = async (): Promise<void> => {
    const marker = randomUUID()
    const markerReceived = waitFor('task-ran', marker)
    await bus.publish(new TaskRan(marker))
    await markerReceived
  }

  beforeAll(async () => {
    pool = new Pool(configuration.connection)
    await pool.query(`drop schema if exists "${schemaName}" cascade`)
    bus = Bus.configure()
      .withMessageTypes(messageTypes)
      .withLogger(() => Mock.ofType<Logger>().object)
      .withTransport(new InMemoryQueue({ receiveTimeoutMs: 100 }))
      .withPersistence(new PostgresPersistence(configuration))
      .withOutbox()
      .withRecoverability(({ message, error }) => {
        const { value } = message as RunTask
        deadLetterErrors.set(value, error)
        events.emit('dead-lettered', value)
        return deadLetter()
      })
      .withHandler(
        handlerFor(RunTask, async ({ value }, _attributes, ctx) => {
          await postgresTransaction(ctx).query(
            `insert into ${ordersTable} (id) values ($1)`,
            [value]
          )
          if (value.startsWith('swallow')) {
            // Fails the transaction, though the error is caught
            await postgresTransaction(ctx)
              .query('select 1 / 0')
              .catch(() => undefined)
            // Sends nothing, so the first statement after the failure is the commit
            return
          }
          await ctx.publish(new TaskRan(value))
        })
      )
      .withHandler(
        handlerFor(RunTask, ({ value }) => {
          if (value.startsWith('fail')) {
            throw new Error('Handler failed')
          }
        })
      )
      .withHandler(
        handlerFor(TaskRan, ({ value }) => {
          events.emit('task-ran', value)
        })
      )
      .withAutoProvision()
      .build()
    await bus.initialize()
    await pool.query(`create table ${ordersTable} (id text primary key)`)
    await bus.start()
  })

  afterAll(async () => {
    await bus.dispose()
    await pool.query(`drop schema if exists "${schemaName}" cascade`)
    await pool.end()
  })

  describe('when a handler writes with it and every handler succeeds', () => {
    const orderId = randomUUID()

    beforeAll(async () => {
      const taskRan = waitFor('task-ran', orderId)
      await bus.send(new RunTask(orderId))
      await taskRan
    })

    it('should keep what the handler wrote', async () => {
      expect(await orderExists(orderId)).toEqual(true)
    })
  })

  describe('when a statement fails and the handler catches the error', () => {
    const orderId = `swallow-${randomUUID()}`

    beforeAll(async () => {
      const deadLettered = waitFor('dead-lettered', orderId)
      await bus.send(new RunTask(orderId))
      await deadLettered
      await drainQueue()
    })

    it('should fail the message with TransactionRolledBack', () => {
      expect(deadLetterErrors.get(orderId)).toBeInstanceOf(
        TransactionRolledBack
      )
    })

    it('should keep nothing the handler wrote', async () => {
      expect(await orderExists(orderId)).toEqual(false)
    })
  })

  describe('when a handler writes with it and another handler fails', () => {
    const orderId = `fail-${randomUUID()}`

    beforeAll(async () => {
      const deadLettered = waitFor('dead-lettered', orderId)
      await bus.send(new RunTask(orderId))
      await deadLettered
      await drainQueue()
    })

    it('should roll back what the handler wrote', async () => {
      expect(await orderExists(orderId)).toEqual(false)
    })
  })

  describe('when bus.transaction() writes with it', () => {
    const orderId = randomUUID()
    let lateError: unknown

    beforeAll(async () => {
      const taskRan = waitFor('task-ran', orderId)
      let transactionContext: TransactionContext | undefined
      await bus.transaction(async ctx => {
        transactionContext = ctx
        await postgresTransaction(ctx).query(
          `insert into ${ordersTable} (id) values ($1)`,
          [orderId]
        )
        await ctx.publish(new TaskRan(orderId))
      })
      await taskRan
      try {
        postgresTransaction(transactionContext!)
      } catch (error) {
        lateError = error
      }
    })

    it('should keep what it wrote', async () => {
      expect(await orderExists(orderId)).toEqual(true)
    })

    it('should not give out the client once the transaction has ended', () => {
      expect(lateError).toBeInstanceOf(TransactionNotActive)
    })
  })

  describe('when the work of bus.transaction() writes with it and throws', () => {
    const orderId = randomUUID()

    beforeAll(async () => {
      await bus
        .transaction(async ctx => {
          await postgresTransaction(ctx).query(
            `insert into ${ordersTable} (id) values ($1)`,
            [orderId]
          )
          await ctx.publish(new TaskRan(orderId))
          throw new Error('Work failed')
        })
        .catch(() => undefined)
      await drainQueue()
    })

    it('should roll back what it wrote', async () => {
      expect(await orderExists(orderId)).toEqual(false)
    })
  })
})

describe('PostgresPersistence', () => {
  describe('when a workflow message matches no instance in its transaction, with a pool of one connection', () => {
    const missSchemaName = 'outbox_workflow_miss'
    const registryLogger = Mock.ofType<Logger>()
    let bus: BusInstance
    let pool: Pool

    beforeAll(async () => {
      pool = new Pool(configuration.connection)
      await pool.query(`drop schema if exists "${missSchemaName}" cascade`)
      const events = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(target =>
          target === '@node-ts/bus-core:workflow-registry'
            ? registryLogger.object
            : Mock.ofType<Logger>().object
        )
        .withTransport(new InMemoryQueue({ receiveTimeoutMs: 100 }))
        // The transaction holds the only connection, so a query on the pool while it's open would never run
        .withPersistence(
          new PostgresPersistence({
            connection: { ...configuration.connection, max: 1 },
            schemaName: missSchemaName
          })
        )
        .withOutbox()
        .withWorkflow(TestWorkflow)
        .withAutoProvision()
        .withMiddleware({
          incoming: async (_context, next) => {
            await next()
            events.emit('handled')
          }
        })
        .build()
      await bus.initialize()
      await bus.start()
      const handled = once(events, 'handled')
      await bus.publish(new TaskRan(randomUUID()))
      await handled
    })

    afterAll(async () => {
      await bus.dispose()
      await pool.query(`drop schema if exists "${missSchemaName}" cascade`)
      await pool.end()
    })

    it('should look for a completed instance in the transaction, and ignore the message', () => {
      registryLogger.verify(
        l =>
          l.warn(
            'No workflow instance found for message. Ignoring.',
            It.isAny()
          ),
        Times.once()
      )
    })
  })
})
