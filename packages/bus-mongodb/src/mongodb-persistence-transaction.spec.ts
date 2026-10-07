import {
  Logger,
  TransactionNotActive,
  TransactionNotActiveReason,
  TransactionRollbackReason,
  TransactionRolledBack,
  WorkflowState
} from '@node-ts/bus-core'
import { ClientSession, MongoServerError } from 'mongodb'
import { IMock, It, Mock, Times } from 'typemoq'
import { mongoSession } from './mongo-session'
import {
  MongodbPersistenceTransaction,
  TRANSACTION_OPTIONS,
  TransactionOperations
} from './mongodb-persistence-transaction'

const writeConflict = () =>
  new MongoServerError({
    message: 'Write conflict',
    code: 112,
    codeName: 'WriteConflict',
    errorLabels: ['TransientTransactionError']
  })

describe('MongodbPersistenceTransaction', () => {
  let sut: MongodbPersistenceTransaction
  let session: IMock<ClientSession>
  let operations: IMock<TransactionOperations>

  beforeEach(() => {
    session = Mock.ofType<ClientSession>()
    session.setup(s => s.inTransaction()).returns(() => true)
    operations = Mock.ofType<TransactionOperations>()
    sut = new MongodbPersistenceTransaction(
      session.object,
      Mock.ofType<Logger>().object,
      operations.object
    )
  })

  describe('when its session is read with mongoSession(ctx)', () => {
    let result: ClientSession

    beforeEach(() => {
      result = mongoSession({ transaction: sut })
    })

    it('should return the session of the transaction', () => {
      expect(result).toBe(session.object)
    })
  })

  describe('when started', () => {
    beforeEach(async () => {
      await sut.start()
    })

    it('should run the read that starts the transaction on the server', () => {
      operations.verify(async o => o.start(), Times.once())
    })
  })

  describe('when a message is recorded first, while another transaction holds its record', () => {
    let recorded: boolean
    let attempts: number

    beforeEach(async () => {
      attempts = 0
      operations
        .setup(async o => o.recordIncomingMessage('endpoint', 'message-id'))
        .returns(async () => {
          attempts++
          if (attempts < 3) {
            throw writeConflict()
          }
          return false
        })
      await sut.start()
      recorded = await sut.recordIncomingMessage('endpoint', 'message-id')
    })

    it('should start the transaction again until the other one ends', () => {
      expect(attempts).toEqual(3)
      session.verify(async s => s.abortTransaction(), Times.exactly(2))
      session.verify(
        s => s.startTransaction(TRANSACTION_OPTIONS),
        Times.exactly(2)
      )
    })

    it('should return whether it was recorded once it has', () => {
      expect(recorded).toEqual(false)
    })
  })

  describe('when a message is recorded after another operation, while another transaction holds its record', () => {
    let error: unknown

    beforeEach(async () => {
      operations
        .setup(async o => o.storeOutgoingMessages(It.isAny()))
        .returns(async () => [])
      operations
        .setup(async o => o.recordIncomingMessage('endpoint', 'message-id'))
        .returns(async () => {
          throw writeConflict()
        })
      await sut.storeOutgoingMessages([])
      error = await sut
        .recordIncomingMessage('endpoint', 'message-id')
        .catch((e: unknown) => e)
    })

    it('should throw the conflict, rather than drop what the transaction did', () => {
      expect(error).toBeInstanceOf(MongoServerError)
      session.verify(async s => s.abortTransaction(), Times.never())
    })
  })

  describe('when a message is recorded after a handler used the session, while another transaction holds its record', () => {
    let error: unknown

    beforeEach(async () => {
      operations
        .setup(async o => o.recordIncomingMessage('endpoint', 'message-id'))
        .returns(async () => {
          throw writeConflict()
        })
      mongoSession({ transaction: sut })
      error = await sut
        .recordIncomingMessage('endpoint', 'message-id')
        .catch((e: unknown) => e)
    })

    it('should throw the conflict, rather than drop what the handler did', () => {
      expect(error).toBeInstanceOf(MongoServerError)
      session.verify(async s => s.abortTransaction(), Times.never())
    })
  })

  describe('when operations are called at once', () => {
    const order: string[] = []
    let finishFirst: () => void

    beforeEach(async () => {
      order.length = 0
      operations
        .setup(async o =>
          o.getWorkflowState(
            It.isAny(),
            It.isAny(),
            It.isAny(),
            It.isAny(),
            It.isAny()
          )
        )
        .returns(async () => {
          order.push('get started')
          await new Promise<void>(resolve => {
            finishFirst = resolve
          })
          order.push('get finished')
          return []
        })
      operations
        .setup(async o => o.saveWorkflowState(It.isAny()))
        .returns(async () => {
          order.push('save')
        })
      const get = sut.getWorkflowState(
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never
      )
      const save = sut.saveWorkflowState({} as WorkflowState)
      await new Promise(resolve => setImmediate(resolve))
      finishFirst()
      await Promise.all([get, save])
    })

    it('should run them one at a time, in the order they were called', () => {
      expect(order).toEqual(['get started', 'get finished', 'save'])
    })
  })

  describe('when committed', () => {
    let lateError: unknown

    beforeEach(async () => {
      await sut.commit()
      try {
        mongoSession({ transaction: sut })
      } catch (error) {
        lateError = error
      }
    })

    it('should commit the transaction and end the session', () => {
      session.verify(async s => s.commitTransaction(), Times.once())
      session.verify(async s => s.endSession(), Times.once())
    })

    it('should no longer give out its session', () => {
      expect(lateError).toBeInstanceOf(TransactionNotActive)
      expect(lateError).toMatchObject({
        persistenceName: 'MongodbPersistence',
        reason: TransactionNotActiveReason.Ended
      })
    })
  })

  describe('when the result of the commit is unknown', () => {
    let commits: number

    beforeEach(async () => {
      commits = 0
      session
        .setup(async s => s.commitTransaction())
        .returns(async () => {
          commits++
          if (commits === 1) {
            throw new MongoServerError({
              message: 'Network error',
              errorLabels: ['UnknownTransactionCommitResult']
            })
          }
        })
      await sut.commit()
    })

    it('should commit again', () => {
      expect(commits).toEqual(2)
    })
  })

  describe('when MongoDB aborted the transaction before it was committed', () => {
    let error: unknown

    beforeEach(async () => {
      session
        .setup(async s => s.commitTransaction())
        .returns(async () => {
          throw new MongoServerError({
            message: 'Transaction has been aborted',
            code: 251,
            codeName: 'NoSuchTransaction',
            errorLabels: ['TransientTransactionError']
          })
        })
      error = await sut.commit().catch((e: unknown) => e)
    })

    it('should throw TransactionRolledBack, saying the database aborted it', () => {
      expect(error).toBeInstanceOf(TransactionRolledBack)
      expect(error).toMatchObject({
        reason: TransactionRollbackReason.AbortedByDatabase,
        persistenceName: 'MongodbPersistence'
      })
    })

    it('should end the session', () => {
      session.verify(async s => s.endSession(), Times.once())
    })
  })

  describe('when rolled back', () => {
    let error: unknown

    beforeEach(async () => {
      await sut.rollback()
      error = await sut
        .saveWorkflowState({} as WorkflowState)
        .catch((e: unknown) => e)
    })

    it('should abort the transaction and end the session', () => {
      session.verify(async s => s.abortTransaction(), Times.once())
      session.verify(async s => s.endSession(), Times.once())
    })

    it('should reject later calls with TransactionNotActive', () => {
      expect(error).toBeInstanceOf(TransactionNotActive)
    })

    it('should not run later calls', () => {
      operations.verify(
        async o => o.saveWorkflowState(It.isAny()),
        Times.never()
      )
    })
  })

  describe('when rolled back after MongoDB ended the transaction', () => {
    beforeEach(async () => {
      session.reset()
      session.setup(s => s.inTransaction()).returns(() => false)
      await sut.rollback()
    })

    it('should only end the session', () => {
      session.verify(async s => s.abortTransaction(), Times.never())
      session.verify(async s => s.endSession(), Times.once())
    })
  })
})
