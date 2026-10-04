import {
  TransactionNotActive,
  TransactionNotActiveReason
} from '@node-ts/bus-core'
import { postgresTestTransaction } from './postgres-test-transaction'
import { postgresTransaction } from './postgres-transaction'

describe('postgresTransaction', () => {
  describe('when the context has no transaction', () => {
    let error: unknown

    beforeAll(() => {
      try {
        postgresTransaction({})
      } catch (e) {
        error = e
      }
    })

    it('should throw TransactionNotActive naming the accessor and why', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
      expect(error).toMatchObject({
        operation: 'postgresTransaction(ctx)',
        persistenceName: 'PostgresPersistence',
        reason: TransactionNotActiveReason.NoTransaction
      })
    })
  })

  describe("when the context has another persistence's transaction", () => {
    let error: unknown

    beforeAll(() => {
      try {
        postgresTransaction({ transaction: {} })
      } catch (e) {
        error = e
      }
    })

    it('should throw TransactionNotActive saying so', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
      expect(error).toMatchObject({
        reason: TransactionNotActiveReason.OtherPersistence
      })
    })
  })

  describe('when the context has a test transaction', () => {
    const queries: unknown[][] = []
    let result: unknown

    beforeAll(async () => {
      const transaction = postgresTestTransaction({
        query: async (...args: unknown[]) => {
          queries.push(args)
          return { rows: [{ id: 1 }] }
        }
      })
      result = await postgresTransaction({ transaction }).query(
        'insert into orders (id) values ($1)',
        ['1']
      )
    })

    it('should run the query on the fake client', () => {
      expect(queries).toEqual([['insert into orders (id) values ($1)', ['1']]])
    })

    it('should return what the fake client returns', () => {
      expect(result).toEqual({ rows: [{ id: 1 }] })
    })
  })
})
