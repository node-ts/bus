import { InMemoryPersistence } from './in-memory-persistence'
import { TestWorkflowState, TestCommand } from '../test'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from '../workflow-state'

describe('InMemoryPersistence', () => {
  let sut: InMemoryPersistence
  const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
    lookup: ({ message }) => message.property1,
    mapsTo: 'property1'
  }

  beforeEach(() => {
    sut = new InMemoryPersistence()
  })

  describe('when getting workflow state', () => {
    const messageOptions = new MessageAttributes()

    beforeEach(async () => {
      const mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
        lookup: command => command.property1,
        mapsTo: 'property1'
      }
      await sut.initializeWorkflow(
        TestWorkflowState,
        [mapping as MessageWorkflowMapping<Message, WorkflowState>]
      )
    })

    describe('when the mapper doesn\'t resolve', () => {
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

    describe('that doesn\'t exist', () => {
      let result: TestWorkflowState[]
      const unmatchedMapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
        lookup: testMessage => testMessage.$name,
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
    beforeEach(async () => {
      await sut.initializeWorkflow(
        TestWorkflowState,
        [propertyMapping as MessageWorkflowMapping<Message, WorkflowState>]
      )
    })

    describe('for a new workflow', () => {
      beforeEach(async () => {
        await sut.saveWorkflowState(new TestWorkflowState())
      })

      it('should add the item to memory', () => {
        expect(sut.length(TestWorkflowState)).toEqual(1)
      })
    })

    describe('for an existing workflow', () => {
      const testCommand = new TestCommand('a')
      const workflowId = 'abc'
      const messageOptions = new MessageAttributes()

      beforeEach(async () => {
        const workflowState = new TestWorkflowState()
        workflowState.$workflowId = workflowId
        workflowState.$status = WorkflowStatus.Running
        await sut.saveWorkflowState(workflowState)

        workflowState.property1 = testCommand.property1!
        await sut.saveWorkflowState(workflowState)
      })

      it('should save in place', () => {
        expect(sut.length(TestWorkflowState)).toEqual(1)
      })

      it('should save the changes', async () => {
        const workflowState = await sut.getWorkflowState(
          TestWorkflowState,
          propertyMapping,
          testCommand,
          messageOptions
        )

        expect(workflowState).toHaveLength(1)
        expect(workflowState[0].$workflowId).toEqual(workflowId)
        expect(workflowState[0].property1).toEqual(testCommand.property1)
      })
    })
  })
})
