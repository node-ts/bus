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
import { Collection, MongoClient } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import { messageTypes, RunTask, TaskRan } from '../test'
import { mongoSession } from './mongo-session'
import { MongodbConfiguration } from './mongodb-configuration'
import { MongodbPersistence } from './mongodb-persistence'

jest.setTimeout(20_000)

const configuration: MongodbConfiguration = {
  connection:
    process.env.MONGODB_URL ||
    'mongodb://localhost:27017/workflows?directConnection=true',
  databaseName: 'outbox_session'
}

interface Order {
  _id: string
}

describe('mongoSession', () => {
  const events = new EventEmitter()
  const deadLetterErrors = new Map<string, unknown>()
  // The persistence's own client, since a session only runs operations on the client that started it
  const client = new MongoClient(configuration.connection)
  let orders: Collection<Order>
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

  const orderExists = async (orderId: string): Promise<boolean> =>
    (await orders.countDocuments({ _id: orderId })) === 1

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
    await client.connect()
    const database = client.db(configuration.databaseName)
    await database.dropDatabase()
    orders = database.collection<Order>('orders')
    await database.createCollection('orders')
    bus = Bus.configure()
      .withMessageTypes(messageTypes)
      .withLogger(() => Mock.ofType<Logger>().object)
      .withTransport(new InMemoryQueue({ receiveTimeoutMs: 100 }))
      .withPersistence(new MongodbPersistence(configuration, client))
      .withOutbox()
      .withRecoverability(({ message, error }) => {
        const { value } = message as RunTask
        deadLetterErrors.set(value, error)
        events.emit('dead-lettered', value)
        return deadLetter()
      })
      .withHandler(
        handlerFor(RunTask, async ({ value }, _attributes, ctx) => {
          const session = mongoSession(ctx)
          await orders.insertOne({ _id: value }, { session })
          if (value.startsWith('swallow')) {
            // A duplicate key aborts the transaction, though the error is caught
            await orders
              .insertOne({ _id: value }, { session })
              .catch(() => undefined)
            // Sends nothing, so the next operation after the failure is the commit
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
    await bus.start()
  })

  afterAll(async () => {
    await client.db(configuration.databaseName).dropDatabase()
    // Closes the client, which the persistence was given
    await bus.dispose()
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

  describe('when an operation fails and the handler catches the error', () => {
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
        await orders.insertOne({ _id: orderId }, { session: mongoSession(ctx) })
        await ctx.publish(new TaskRan(orderId))
      })
      await taskRan
      try {
        mongoSession(transactionContext!)
      } catch (error) {
        lateError = error
      }
    })

    it('should keep what it wrote', async () => {
      expect(await orderExists(orderId)).toEqual(true)
    })

    it('should not give out the session once the transaction has ended', () => {
      expect(lateError).toBeInstanceOf(TransactionNotActive)
    })
  })

  describe('when the work of bus.transaction() writes with it and throws', () => {
    const orderId = randomUUID()

    beforeAll(async () => {
      await bus
        .transaction(async ctx => {
          await orders.insertOne(
            { _id: orderId },
            { session: mongoSession(ctx) }
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
