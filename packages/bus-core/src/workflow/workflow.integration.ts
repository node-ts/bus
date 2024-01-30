import { InMemoryPersistence } from './persistence'
import {
  TestCommand,
  TestWorkflowState,
  TestWorkflow,
  TaskRan,
  FinalTask
} from './test'
import { WorkflowStatus } from './workflow-state'
import {
  TestWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import {
  TestWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from './test/test-workflow-startedby-discard'
import { MessageAttributes } from '@node-ts/bus-messages'
import { Bus, BusInstance } from '../service-bus'
import { ClassConstructor, sleep } from '../util'
import { MessageWorkflowMapping } from './message-workflow-mapping'

describe('Workflow', () => {
  const command = new TestCommand('abc')
  const CONSUME_TIMEOUT = 500
  let bus: BusInstance
  const inMemoryPersistence = new InMemoryPersistence()

  beforeAll(async () => {
    bus = Bus.configure()
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
      expect(data.$version).toEqual(0)
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

      describe('and then a final message arrives', () => {
        const finalTask = new FinalTask()
        let finalWorkflowState: TestWorkflowState[]

        beforeAll(async () => {
          await bus.publish(finalTask, {
            correlationId: nextWorkflowState[0].$workflowId
          })
          await sleep(CONSUME_TIMEOUT)

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
