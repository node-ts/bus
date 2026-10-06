import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { TransactionNotActive, TransactionNotActiveReason } from '../../outbox'
import { OutgoingMessage } from '../../outgoing-message'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { TestCommand, TestWorkflowState } from '../test'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import {
  OutgoingMessageStoredConcurrently,
  WorkflowStateNotInitialized,
  WorkflowStateVersionConflict
} from './error'
import { InMemoryPersistence } from './in-memory-persistence'
import { PersistenceTransaction } from './persistence-transaction'

describe('InMemoryPersistence', () => {
  let sut: InMemoryPersistence
  const propertyMapping: MessageWorkflowMapping<
    TestCommand,
    TestWorkflowState
  > = {
    lookup: message => message.property1,
    mapsTo: 'property1'
  }

  beforeEach(() => {
    sut = new InMemoryPersistence()
  })

  describe('when getting workflow state', () => {
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }

    beforeEach(async () => {
      const mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
        lookup: message => message.property1,
        mapsTo: 'property1'
      }
      await sut.initializeWorkflow(TestWorkflowState, [
        mapping as MessageWorkflowMapping<Message, WorkflowState>
      ])
    })

    describe("when the mapper doesn't resolve", () => {
      let result: TestWorkflowState[]

      beforeEach(async () => {
        const message = new TestCommand(undefined)
        result = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          message,
          messageOptions
        )
      })

      it('should return an empty result', () => {
        expect(result).toHaveLength(0)
      })
    })

    describe("that doesn't exist", () => {
      let result: TestWorkflowState[]
      const unmatchedMapping: MessageWorkflowMapping<
        TestCommand,
        TestWorkflowState
      > = {
        lookup: message => message.$name,
        mapsTo: '$workflowId'
      }

      beforeEach(async () => {
        result = await sut.getWorkflowState(
          TestWorkflowState,
          unmatchedMapping,
          new TestCommand('abc'),
          messageOptions
        )
      })

      it('should return an empty result', () => {
        expect(result).toHaveLength(0)
      })
    })
  })

  describe('when saving workflow state', () => {
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }

    beforeEach(async () => {
      await sut.initializeWorkflow(TestWorkflowState, [
        propertyMapping as MessageWorkflowMapping<Message, WorkflowState>
      ])
    })

    describe('for a new workflow', () => {
      const workflowState = new TestWorkflowState()

      beforeEach(async () => {
        workflowState.$workflowId = 'new'
        await sut.saveWorkflowState(workflowState)
      })

      it('should add the item to memory', () => {
        expect(sut.length(TestWorkflowState)).toEqual(1)
      })

      it('should not modify the saved object', () => {
        expect(workflowState.$version).toEqual(0)
      })
    })

    describe('for an existing workflow', () => {
      const testCommand = new TestCommand('a')
      const workflowId = 'abc'
      let savedWorkflowState: TestWorkflowState[]

      beforeEach(async () => {
        const workflowState = new TestWorkflowState()
        workflowState.$workflowId = workflowId
        workflowState.$status = WorkflowStatus.Running
        workflowState.property1 = testCommand.property1!
        await sut.saveWorkflowState(workflowState)

        const [storedWorkflowState] = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )
        storedWorkflowState.eventValue = 'b'
        await sut.saveWorkflowState(storedWorkflowState)

        savedWorkflowState = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )
      })

      it('should save in place', () => {
        expect(sut.length(TestWorkflowState)).toEqual(1)
      })

      it('should save the changes', () => {
        expect(savedWorkflowState).toHaveLength(1)
        expect(savedWorkflowState[0].$workflowId).toEqual(workflowId)
        expect(savedWorkflowState[0].property1).toEqual(testCommand.property1)
        expect(savedWorkflowState[0].eventValue).toEqual('b')
      })

      it('should increment the version on each save', () => {
        expect(savedWorkflowState[0].$version).toEqual(2)
      })

      it('should return instances of the workflow state class', () => {
        expect(savedWorkflowState[0]).toBeInstanceOf(TestWorkflowState)
      })
    })

    describe('with a stale version', () => {
      let error: unknown

      beforeEach(async () => {
        const workflowState = new TestWorkflowState()
        workflowState.$workflowId = 'stale'
        workflowState.$status = WorkflowStatus.Running
        await sut.saveWorkflowState(workflowState)

        try {
          // Saving the version 0 object again simulates a concurrent write that read the state before the first save
          await sut.saveWorkflowState(workflowState)
        } catch (e) {
          error = e
        }
      })

      it('should throw a WorkflowStateVersionConflict', () => {
        expect(error).toBeInstanceOf(WorkflowStateVersionConflict)
        expect(error).toMatchObject({
          workflowId: 'stale',
          expectedVersion: 0,
          actualVersion: 1
        })
      })

      it('should not save the changes', () => {
        expect(sut.length(TestWorkflowState)).toEqual(1)
      })
    })

    describe('with a version that has never been saved', () => {
      let error: unknown

      beforeEach(async () => {
        const workflowState = new TestWorkflowState()
        workflowState.$workflowId = 'missing'
        workflowState.$version = 3
        try {
          await sut.saveWorkflowState(workflowState)
        } catch (e) {
          error = e
        }
      })

      it('should throw a WorkflowStateVersionConflict', () => {
        expect(error).toBeInstanceOf(WorkflowStateVersionConflict)
        expect(error).toMatchObject({
          expectedVersion: 3,
          actualVersion: undefined
        })
      })
    })
  })

  describe('when getting the length', () => {
    describe('without initializing the workflow', () => {
      it('should throw a WorkflowStateNotInitialized', () => {
        expect(() => sut.length(TestWorkflowState)).toThrow(
          WorkflowStateNotInitialized
        )
      })
    })

    describe('for a workflow state without a static NAME', () => {
      class UnnamedWorkflowState extends WorkflowState {
        $name = 'unnamed-workflow-state'
      }

      beforeEach(async () => {
        await sut.initializeWorkflow(UnnamedWorkflowState, [])
        const workflowState = new UnnamedWorkflowState()
        workflowState.$workflowId = 'unnamed'
        await sut.saveWorkflowState(workflowState)
      })

      it('should count the saved workflow states', () => {
        expect(sut.length(UnnamedWorkflowState)).toEqual(1)
      })
    })
  })

  describe('when using a transaction', () => {
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    const testCommand = new TestCommand('in-transaction')
    let transaction: PersistenceTransaction

    const createWorkflowState = (workflowId: string): TestWorkflowState => {
      const workflowState = new TestWorkflowState()
      workflowState.$workflowId = workflowId
      workflowState.$status = WorkflowStatus.Running
      workflowState.$version = 0
      workflowState.property1 = testCommand.property1!
      return workflowState
    }

    const createOutgoingMessage = (id: string): OutgoingMessage => ({
      id,
      kind: 'publish',
      message: { $name: 'test-event', $version: 0 },
      attributes: { attributes: {}, stickyAttributes: {} },
      headers: {},
      dueAt: new Date(0)
    })

    const claimAll = async () =>
      sut.claimDueOutgoingMessages(100, 1_000, 1_000, new Date(1_000))

    beforeEach(async () => {
      await sut.initializeWorkflow(TestWorkflowState, [
        propertyMapping as MessageWorkflowMapping<Message, WorkflowState>
      ])
      transaction = await sut.beginTransaction()
    })

    describe('and a message whose lookup has no value is looked up in it', () => {
      let result: TestWorkflowState[]

      beforeEach(async () => {
        const workflowState = createWorkflowState('empty-lookup')
        workflowState.property1 = ''
        await transaction.saveWorkflowState(workflowState)
        result = await transaction.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          new TestCommand(''),
          messageOptions
        )
      })

      it('should return no workflow state, even one whose mapped field is empty', () => {
        expect(result).toEqual([])
      })
    })

    describe('and workflow state is saved in it', () => {
      let readInTransaction: TestWorkflowState[]
      let readOutside: TestWorkflowState[]

      beforeEach(async () => {
        await transaction.saveWorkflowState(createWorkflowState('saved'))
        readInTransaction = await transaction.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )
        readOutside = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )
      })

      it('should read it back in the transaction, at its next version', () => {
        expect(readInTransaction).toHaveLength(1)
        expect(readInTransaction[0]).toBeInstanceOf(TestWorkflowState)
        expect(readInTransaction[0].$version).toEqual(1)
      })

      it('should not show it outside the transaction', () => {
        expect(readOutside).toHaveLength(0)
      })

      describe('and the transaction is committed', () => {
        beforeEach(async () => transaction.commit())

        it('should keep it', () => {
          expect(sut.length(TestWorkflowState)).toEqual(1)
        })
      })

      describe('and the transaction is rolled back', () => {
        beforeEach(async () => transaction.rollback())

        it('should not keep it', () => {
          expect(sut.length(TestWorkflowState)).toEqual(0)
        })
      })

      describe('and it is saved again in the transaction with its old version', () => {
        let error: unknown

        beforeEach(async () => {
          error = await transaction
            .saveWorkflowState(createWorkflowState('saved'))
            .catch((e: unknown) => e)
        })

        it('should throw a WorkflowStateVersionConflict', () => {
          expect(error).toBeInstanceOf(WorkflowStateVersionConflict)
          expect(error).toMatchObject({ expectedVersion: 0, actualVersion: 1 })
        })
      })
    })

    describe('and the workflow state it saved is saved elsewhere before it commits', () => {
      let error: unknown

      beforeEach(async () => {
        await transaction.saveWorkflowState(createWorkflowState('contended'))
        await transaction.storeOutgoingMessages([
          createOutgoingMessage('contended')
        ])
        await sut.saveWorkflowState(createWorkflowState('contended'))
        error = await transaction.commit().catch((e: unknown) => e)
      })

      it('should throw a WorkflowStateVersionConflict', () => {
        expect(error).toBeInstanceOf(WorkflowStateVersionConflict)
        expect(error).toMatchObject({
          workflowId: 'contended',
          expectedVersion: 0,
          actualVersion: 1
        })
      })

      it('should keep none of its changes', async () => {
        const [stored] = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )
        expect(stored.$version).toEqual(1)
        expect(await claimAll()).toHaveLength(0)
      })
    })

    describe('and outgoing messages are stored in it', () => {
      let duplicateIds: string[]
      let claimedBeforeCommit: OutgoingMessage[]

      beforeEach(async () => {
        await sut.storeOutgoingMessages([createOutgoingMessage('existing')])
        duplicateIds = await transaction.storeOutgoingMessages([
          createOutgoingMessage('existing'),
          createOutgoingMessage('new'),
          createOutgoingMessage('new')
        ])
        claimedBeforeCommit = await claimAll()
        await sut.releaseOutgoingMessages(
          claimedBeforeCommit.map(({ id }) => ({ id, attempts: 1 }))
        )
      })

      it('should report the ids already stored, in or out of the transaction', () => {
        expect(duplicateIds).toEqual(['existing', 'new'])
      })

      it('should not store them before the transaction is committed', () => {
        expect(claimedBeforeCommit.map(({ id }) => id)).toEqual(['existing'])
      })

      describe('and the transaction is committed', () => {
        beforeEach(async () => transaction.commit())

        it('should store them', async () => {
          expect((await claimAll()).map(({ id }) => id).sort()).toEqual([
            'existing',
            'new'
          ])
        })
      })
    })

    describe('and another transaction stores a message with the same id and commits first', () => {
      let error: unknown

      beforeEach(async () => {
        await transaction.saveWorkflowState(createWorkflowState('raced'))
        await transaction.storeOutgoingMessages([
          createOutgoingMessage('raced')
        ])
        const other = await sut.beginTransaction()
        await other.storeOutgoingMessages([createOutgoingMessage('raced')])
        await other.commit()
        error = await transaction.commit().catch((e: unknown) => e)
      })

      it('should throw OutgoingMessageStoredConcurrently', () => {
        expect(error).toBeInstanceOf(OutgoingMessageStoredConcurrently)
        expect(error).toMatchObject({ messageId: 'raced' })
      })

      it('should keep none of its changes', () => {
        expect(sut.length(TestWorkflowState)).toEqual(0)
      })
    })

    describe('and it is used after it is committed', () => {
      let error: unknown

      beforeEach(async () => {
        await transaction.commit()
        error = await transaction
          .saveWorkflowState(createWorkflowState('late'))
          .catch((e: unknown) => e)
      })

      it('should throw TransactionNotActive', () => {
        expect(error).toBeInstanceOf(TransactionNotActive)
        expect(error).toMatchObject({
          operation: 'saveWorkflowState',
          persistenceName: 'InMemoryPersistence',
          reason: TransactionNotActiveReason.Ended
        })
      })

      it('should not save anything', () => {
        expect(sut.length(TestWorkflowState)).toEqual(0)
      })
    })
  })
})
