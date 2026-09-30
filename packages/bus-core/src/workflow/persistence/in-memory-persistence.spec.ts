import { InMemoryPersistence } from './in-memory-persistence'
import { TestWorkflowState, TestCommand } from '../test'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import {
  WorkflowStateNotInitialized,
  WorkflowStateVersionConflict
} from './error'

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
})
