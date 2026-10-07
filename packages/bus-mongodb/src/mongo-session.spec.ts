import {
  TransactionNotActive,
  TransactionNotActiveReason
} from '@node-ts/bus-core'
import { ClientSession } from 'mongodb'
import { mongoSession } from './mongo-session'
import { mongoTestSession } from './mongo-test-session'

describe('mongoSession', () => {
  describe('when the context has no transaction', () => {
    let error: unknown

    beforeAll(() => {
      try {
        mongoSession({})
      } catch (e) {
        error = e
      }
    })

    it('should throw TransactionNotActive naming the accessor and why', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
      expect(error).toMatchObject({
        operation: 'mongoSession(ctx)',
        persistenceName: 'MongodbPersistence',
        reason: TransactionNotActiveReason.NoTransaction
      })
    })
  })

  describe("when the context has another persistence's transaction", () => {
    let error: unknown

    beforeAll(() => {
      try {
        mongoSession({ transaction: {} })
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

  describe('when the context has a test session', () => {
    const session = {}
    let result: ClientSession

    beforeAll(() => {
      result = mongoSession({ transaction: mongoTestSession(session) })
    })

    it('should return the fake session', () => {
      expect(result).toBe(session)
    })
  })
})
