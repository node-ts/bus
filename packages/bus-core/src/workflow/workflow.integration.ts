import { InMemoryPersistence } from './persistence'
import { TestCommand, TestWorkflowState, TestWorkflow, TaskRan, FinalTask } from './test'
import { WorkflowStatus } from './workflow-state'
import {
  testWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import {
  testWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from './test/test-workflow-startedby-discard'
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
      .withWorkflow(TestWorkflow)
      // .withWorkflow(testWorkflowStartedByCompletes)
      // .withWorkflow(testWorkflowStartedByDiscard)
      .initialize()

    await Bus.start()
    await Bus.send(command)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await Bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }
    let workflowState: TestWorkflowState[]
    const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }

    beforeAll(async () => {
      workflowState = await getPersistence().getWorkflowState<TestWorkflowState, TestCommand>(
        TestWorkflowState,
        propertyMapping,
        command,
        messageOptions
      )
    })

    it('should start a new workflow', () => {
      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(0)
      expect(data).toMatchObject({ property1: command.property1 })
    })

    describe('and then a message for the next step is received', () => {
      const event = new TaskRan('abc')
      let nextWorkflowState: TestWorkflowState[]

      beforeAll(async () => {
        await Bus.publish(event)
        await sleep(CONSUME_TIMEOUT)

        nextWorkflowState = await getPersistence().getWorkflowState<TestWorkflowState, TestCommand>(
          TestWorkflowState,
          propertyMapping,
          command,
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(nextWorkflowState).toHaveLength(1)
      })

      describe('and then a final message arrives', () => {
        const finalTask = new FinalTask()
        let finalWorkflowState: TestWorkflowState[]

        beforeAll(async () => {
          await Bus.publish(
            finalTask,
            { correlationId: nextWorkflowState[0].$workflowId }
          )
          await sleep(CONSUME_TIMEOUT)

          finalWorkflowState = await getPersistence().getWorkflowState<TestWorkflowState, TestCommand>(
            TestWorkflowState,
            propertyMapping,
            command,
            messageOptions,
            true
          )
        })

        it('should mark the workflow as complete', () => {
          expect(finalWorkflowState).toHaveLength(1)
          const data = finalWorkflowState[0]
          expect(data.$status).toEqual(WorkflowStatus.Complete)
        })
      })
    })
  })

  describe('when a workflow is completed in a StartedBy handler', () => {
    const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowStartedByCompletesData> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }

    it('should persist the workflow as completed', async () => {
      const workflowState = await getPersistence().getWorkflowState<TestWorkflowStartedByCompletesData, TestCommand>(
        TestWorkflowStartedByCompletesData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data.$status).toEqual(WorkflowStatus.Complete)
    })
  })

  describe('when a StartedBy handler returns undefined', () => {
    const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
    const propertyMapping: MessageWorkflowMapping<TestCommand, TestWorkflowStartedByDiscardData> = {
      lookup: ({ message }) => message.property1,
      mapsTo: 'property1'
    }

    it('should not persist the workflow', async () => {
      const workflowState = await getPersistence().getWorkflowState<TestWorkflowStartedByDiscardData, TestCommand>(
        TestWorkflowStartedByDiscardData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowState).toHaveLength(0)
    })
  })
})
