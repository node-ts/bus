import {
  Logger,
  PersistenceTransaction,
  TransactionNotActive,
  TransactionNotActiveReason,
  TransactionRollbackReason,
  TransactionRolledBack
} from '@node-ts/bus-core'
import { PoolClient, QueryResult } from 'pg'
import { IMock, It, Mock, Times } from 'typemoq'
import {
  PostgresPersistenceTransaction,
  PostgresTransactionClient
} from './postgres-persistence-transaction'
import { postgresTransaction } from './postgres-transaction'

type TransactionOperations = Pick<
  PersistenceTransaction,
  'getWorkflowState' | 'saveWorkflowState' | 'storeOutgoingMessages'
>

const resultOf = (command: string) =>
  ({ command, rows: [], rowCount: 0 }) as unknown as QueryResult

describe('PostgresPersistenceTransaction', () => {
  let sut: PostgresPersistenceTransaction
  let client: IMock<PoolClient>
  let operations: IMock<TransactionOperations>

  beforeEach(() => {
    client = Mock.ofType<PoolClient>()
    client
      .setup(async c => c.query('commit'))
      .returns(async () => resultOf('COMMIT'))
    client
      .setup(async c => c.query('rollback'))
      .returns(async () => resultOf('ROLLBACK'))
    operations = Mock.ofType<TransactionOperations>()
    sut = new PostgresPersistenceTransaction(
      client.object,
      Mock.ofType<Logger>().object,
      operations.object
    )
  })

  describe('when queried through postgresTransaction(ctx)', () => {
    let result: PostgresTransactionClient

    beforeEach(async () => {
      result = postgresTransaction({ transaction: sut })
      await result.query('select 1')
    })

    it('should run the query on its client', () => {
      client.verify(async c => c.query('select 1'), Times.once())
    })

    it('should only give out query', () => {
      expect(Object.keys(result)).toEqual(['query'])
    })
  })

  describe('when committed', () => {
    let error: unknown
    let keptClientError: unknown

    beforeEach(async () => {
      const keptClient = postgresTransaction({ transaction: sut })
      await sut.commit()
      try {
        postgresTransaction({ transaction: sut })
      } catch (e) {
        error = e
      }
      try {
        await keptClient.query('select 1')
      } catch (e) {
        keptClientError = e
      }
    })

    it('should commit on its client', () => {
      client.verify(async c => c.query('commit'), Times.once())
    })

    it('should return its client to the pool', () => {
      client.verify(c => c.release(), Times.once())
    })

    it('should no longer give out its client', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
      expect(error).toMatchObject({ reason: TransactionNotActiveReason.Ended })
    })

    it('should not run a query on a client that was kept', () => {
      expect(keptClientError).toBeInstanceOf(TransactionNotActive)
      client.verify(async c => c.query('select 1'), Times.never())
    })
  })

  describe('when Postgres rolls it back instead of committing it', () => {
    let error: unknown

    beforeEach(async () => {
      client.reset()
      client
        .setup(async c => c.query('commit'))
        .returns(async () => resultOf('ROLLBACK'))
      error = await sut.commit().catch((e: unknown) => e)
    })

    it('should throw TransactionRolledBack', () => {
      expect(error).toBeInstanceOf(TransactionRolledBack)
      expect(error).toMatchObject({
        reason: TransactionRollbackReason.StatementFailed,
        persistenceName: 'PostgresPersistence'
      })
    })

    it('should return its client to the pool', () => {
      client.verify(c => c.release(), Times.once())
    })
  })

  describe('when rolled back', () => {
    let error: unknown

    beforeEach(async () => {
      await sut.rollback()
      error = await sut.storeOutgoingMessages([]).catch((e: unknown) => e)
    })

    it('should roll back on its client', () => {
      client.verify(async c => c.query('rollback'), Times.once())
    })

    it('should return its client to the pool', () => {
      client.verify(c => c.release(), Times.once())
    })

    it('should reject later calls with TransactionNotActive', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
      expect(error).toMatchObject({
        operation: 'storeOutgoingMessages',
        persistenceName: 'PostgresPersistence',
        reason: TransactionNotActiveReason.Ended
      })
    })

    it('should not run later calls', () => {
      operations.verify(o => o.storeOutgoingMessages(It.isAny()), Times.never())
    })
  })

  describe('when the commit fails', () => {
    const commitError = new Error('Connection lost')
    let error: unknown

    beforeEach(async () => {
      client.reset()
      client
        .setup(async c => c.query('commit'))
        .returns(async () => Promise.reject(commitError))
      error = await sut.commit().catch((e: unknown) => e)
    })

    it('should throw the error', () => {
      expect(error).toBe(commitError)
    })

    it('should destroy its client rather than return it to the pool', () => {
      client.verify(c => c.release(commitError), Times.once())
    })
  })
})
