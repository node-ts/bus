import { MessageAttributes } from '@node-ts/bus-messages'
import { Bus, BusInstance } from '../service-bus'
import { testMessageTypes } from '../test'
import { ClassConstructor, sleep } from '../util'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { InMemoryPersistence } from './persistence'
import { TaskRan, TestCommand, TestWorkflow, TestWorkflowState } from './test'
import {
  TestWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import {
  TestWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from './test/test-workflow-startedby-discard'
import { WorkflowStatus } from './workflow-state'

describe('Workflow', () => {
  const command = new TestCommand('abc')
  const CONSUME_TIMEOUT = 2000
  let bus: BusInstance
  const inMemoryPersistence = new InMemoryPersistence()

  beforeAll(async () => {
    bus = Bus.configure()
      .withMessageTypes(testMessageTypes)
      .withPersistence(inMemoryPersistence)
      .withContainer({
        get<T>(workflowType: ClassConstructor<T>) {
          return new workflowType(bus)
        }
      })
      .withWorkflow(TestWorkflow)
      .withWorkflow(TestWorkflowStartedByCompletes)
      .withWorkflow(TestWorkflowStartedByDiscard)
      .build()

    await bus.initialize()
    await bus.start()
    await bus.send(command)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowState
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }
    let workflowState: TestWorkflowState[]
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }

    beforeAll(async () => {
      workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowState,
        TestCommand
      >(TestWorkflowState, propertyMapping, command, messageOptions)
    })

    it('should start a new workflow', () => {
      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(1)
      expect(data).toMatchObject({ property1: command.property1 })
    })

    describe('and then a message for the next step is received', () => {
      const event = new TaskRan('abc')
      let nextWorkflowState: TestWorkflowState[]

      beforeAll(async () => {
        await bus.publish(event)
        await sleep(CONSUME_TIMEOUT)

        nextWorkflowState = await inMemoryPersistence.getWorkflowState<
          TestWorkflowState,
          TestCommand
        >(TestWorkflowState, propertyMapping, command, messageOptions, true)
      })

      it('should handle that message', () => {
        expect(nextWorkflowState).toHaveLength(1)
      })

      // step2 sends FinalTask from inside the workflow, so it carries the workflow id in its sticky
      // attributes and is routed back to this workflow instance
      describe('and then the final message sent by the workflow is handled', () => {
        let finalWorkflowState: TestWorkflowState[]

        beforeAll(async () => {
          finalWorkflowState = await inMemoryPersistence.getWorkflowState<
            TestWorkflowState,
            TestCommand
          >(TestWorkflowState, propertyMapping, command, messageOptions, true)
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
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowStartedByCompletesData
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }

    it('should persist the workflow as completed', async () => {
      const workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowStartedByCompletesData,
        TestCommand
      >(
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
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowStartedByDiscardData
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }

    it('should not persist the workflow', async () => {
      const workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowStartedByDiscardData,
        TestCommand
      >(
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
