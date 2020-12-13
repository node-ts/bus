import { InMemoryPersistence } from './in-memory-persistence'
import { TestWorkflowData, TestCommand } from '../test'
import { MessageWorkflowMapping } from '../workflow/message-workflow-mapping'
import { WorkflowStatus } from '../workflow/workflow-data'
import { Mock } from 'typemoq'
import { Logger } from '@node-ts/logger-core'
import { MessageAttributes } from '@node-ts/bus-messages'

describe('InMemoryPersistence', () => {
  let sut: InMemoryPersistence
  const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
    message => message.property1,
    'property1'
  )

  beforeEach(() => {
    sut = new InMemoryPersistence(
      Mock.ofType<Logger>().object
    )
  })

  describe('when getting workflow data', () => {
    const messageOptions = new MessageAttributes()

    beforeEach(async () => {
      const mapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData>(
        command => command.property1,
        'property1'
      )
      await sut.initializeWorkflow(
        TestWorkflowData,
        [mapping]
      )
    })

    describe('when the mapper doesn\'t resolve', () => {
      let result: TestWorkflowData[]

      beforeEach(async () => {
        const message = new TestCommand(undefined)
        result = await sut.getWorkflowData(
          TestWorkflowData,
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
      let result: TestWorkflowData[]
      const unmatchedMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
        testMessage => testMessage.$name,
        '$workflowId'
      )

      beforeEach(async () => {
        result = await sut.getWorkflowData(
          TestWorkflowData,
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

  describe('when saving workflow data', () => {
    beforeEach(async () => {
      await sut.initializeWorkflow(
        TestWorkflowData,
        [propertyMapping]
      )
    })

    describe('for a new workflow', () => {
      beforeEach(async () => {
        await sut.saveWorkflowData(new TestWorkflowData())
      })

      it('should add the item to memory', () => {
        expect(sut.length(TestWorkflowData)).toEqual(1)
      })
    })

    describe('for an existing workflow', () => {
      const testCommand = new TestCommand('a')
      const workflowId = 'abc'
      const messageOptions = new MessageAttributes()

      beforeEach(async () => {
        const workflowData = new TestWorkflowData()
        workflowData.$workflowId = workflowId
        workflowData.$status = WorkflowStatus.Running
        await sut.saveWorkflowData(workflowData)

        workflowData.property1 = testCommand.property1!
        await sut.saveWorkflowData(workflowData)
      })

      it('should save in place', () => {
        expect(sut.length(TestWorkflowData)).toEqual(1)
      })

      it('should save the changes', async () => {
        const workflowData = await sut.getWorkflowData(
          TestWorkflowData,
          propertyMapping,
          testCommand,
          messageOptions
        )

        expect(workflowData).toHaveLength(1)
        expect(workflowData[0].$workflowId).toEqual(workflowId)
        expect(workflowData[0].property1).toEqual(testCommand.property1)
      })
    })
  })
})
