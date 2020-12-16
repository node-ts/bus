import { InMemoryPersistence } from './persistence'
import { TestCommand, TestWorkflowData, testWorkflow, TaskRan, FinalTask } from './test'
import { WorkflowStatus } from './workflow-data'
import { Logger } from '@node-ts/logger-core'
import {
  testWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import {
  testWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from './test/test-workflow-startedby-discard'
import { Mock } from 'typemoq'
import { MessageAttributes } from '@node-ts/bus-messages'
import { Bus } from '../service-bus'
import { sleep } from '../util'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { getPersistence } from './persistence/persistence'

describe('Workflow', () => {
  const command = new TestCommand('abc')
  const CONSUME_TIMEOUT = 500

  beforeAll(async () => {

    const inMemoryPersistence = new InMemoryPersistence()

    await Bus.configure()
      .withPersistence(inMemoryPersistence)
      .withLogger(Mock.ofType<Logger>().object)
      .withWorkflow(testWorkflow)
      .withWorkflow(testWorkflowStartedByCompletes)
      .withWorkflow(testWorkflowStartedByDiscard)
      .initialize()

    await Bus.start()
    await Bus.send(command)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await Bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowData> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }
    let workflowData: TestWorkflowData[]
    const messageOptions = new MessageAttributes()

    beforeAll(async () => {
      workflowData = await getPersistence().getWorkflowData<TestWorkflowData, TestCommand>(
        TestWorkflowData,
        propertyMapping,
        command,
        messageOptions
      )
    })

    it('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(0)
      expect(data).toMatchObject({ property1: command.property1 })
    })

    describe('and then a message for the next step is received', () => {
      const event = new TaskRan('abc')
      let nextWorkflowData: TestWorkflowData[]

      beforeAll(async () => {
        await Bus.publish(event)
        await sleep(CONSUME_TIMEOUT)

        nextWorkflowData = await getPersistence().getWorkflowData<TestWorkflowData, TestCommand>(
          TestWorkflowData,
          propertyMapping,
          command,
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(nextWorkflowData).toHaveLength(1)
      })

      describe('and then a final message arrives', () => {
        const finalTask = new FinalTask()
        let finalWorkflowData: TestWorkflowData[]

        beforeAll(async () => {
          await Bus.publish(
            finalTask,
            new MessageAttributes({ correlationId: nextWorkflowData[0].$workflowId })
          )
          await sleep(CONSUME_TIMEOUT)

          finalWorkflowData = await getPersistence().getWorkflowData<TestWorkflowData, TestCommand>(
            TestWorkflowData,
            propertyMapping,
            command,
            messageOptions,
            true
          )
        })

        it('should mark the workflow as complete', () => {
          expect(finalWorkflowData).toHaveLength(1)
          const data = finalWorkflowData[0]
          expect(data.$status).toEqual(WorkflowStatus.Complete)
        })
      })
    })
  })

  describe('when a workflow is completed in a StartedBy handler', () => {
    const messageOptions = new MessageAttributes()
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowStartedByCompletesData> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }

    it('should persist the workflow as completed', async () => {
      const workflowData = await getPersistence().getWorkflowData<TestWorkflowStartedByCompletesData, TestCommand>(
        TestWorkflowStartedByCompletesData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Complete)
    })
  })

  describe('when a StartedBy handler returns undefined', () => {
    const messageOptions = new MessageAttributes()
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowStartedByDiscardData> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }

    it('should not persist the workflow', async () => {
      const workflowData = await getPersistence().getWorkflowData<TestWorkflowStartedByDiscardData, TestCommand>(
        TestWorkflowStartedByDiscardData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowData).toHaveLength(0)
    })
  })
})
