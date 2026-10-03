import { messageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import { Logger } from '../logger'
import { BusMiddleware } from '../middleware'
import { MessageTypesMissing } from '../serialization'
import { Bus, BusInstance } from '../service-bus'
import { messageTypesFor, testMessageTypes } from '../test'
import { defineWorkflow } from './define-workflow'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { InMemoryPersistence } from './persistence'
import {
  FinalTask,
  TaskRan,
  TestCommand,
  TestFunctionStartedByCompletesState,
  testFunctionStartedByCompletesWorkflow,
  TestFunctionStartedByCopyState,
  testFunctionStartedByCopyWorkflow,
  TestFunctionStartedByDiscardState,
  testFunctionStartedByDiscardWorkflow,
  TestFunctionStartedByVoidState,
  testFunctionStartedByVoidWorkflow,
  testFunctionWorkflow,
  TestFunctionWorkflowState
} from './test'
import {
  TestWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import { WorkflowStatus } from './workflow-state'

const handledMessages = new EventEmitter()

/**
 * Emits the name of each message once the bus has handled it
 */
const reportHandled: BusMiddleware = {
  incoming: async (context, next) => {
    await next()
    handledMessages.emit(context.message.$name)
  }
}

/**
 * Resolves once a bus with `reportHandled` has handled a message named `name`
 */
const handled = async (name: string) => {
  await once(handledMessages, name)
}

describe('defineWorkflow', () => {
  const noAttributes = messageAttributes()

  describe('when a workflow declared with defineWorkflow is registered', () => {
    const command = new TestCommand('abc')
    const correlationId = 'define-workflow-correlation-id'
    const persistence = new InMemoryPersistence()
    const byProperty1: MessageWorkflowMapping<
      TestCommand,
      TestFunctionWorkflowState
    > = { lookup: message => message.property1, mapsTo: 'property1' }
    let bus: BusInstance
    let startedState: TestFunctionWorkflowState[]

    beforeAll(async () => {
      bus = Bus.configure()
        .withMiddleware(reportHandled)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withPersistence(persistence)
        // A class workflow and function workflows in one call
        .withWorkflow(
          TestWorkflowStartedByCompletes,
          testFunctionWorkflow,
          testFunctionStartedByCompletesWorkflow,
          testFunctionStartedByCopyWorkflow,
          testFunctionStartedByDiscardWorkflow,
          testFunctionStartedByVoidWorkflow
        )
        .build()
      await bus.initialize()
      await bus.start()

      const started = handled(TestCommand.NAME)
      await bus.send(command, {
        correlationId,
        attributes: { source: 'define-workflow-test' }
      })
      await started
      startedState = await persistence.getWorkflowState(
        TestFunctionWorkflowState,
        byProperty1,
        command,
        noAttributes
      )
    })

    afterAll(async () => bus.dispose())

    describe('and a message that starts it is received', () => {
      it('should start a new workflow', () => {
        expect(startedState).toHaveLength(1)
        expect(startedState[0]).toMatchObject({
          $status: WorkflowStatus.Running,
          $version: 1,
          property1: command.property1
        })
      })

      it('should pass the message attributes in the context', () => {
        expect(startedState[0].source).toEqual('define-workflow-test')
      })
    })

    describe('and its startedBy handler completes the workflow', () => {
      let state: TestFunctionStartedByCompletesState[]

      beforeAll(async () => {
        state = await persistence.getWorkflowState(
          TestFunctionStartedByCompletesState,
          { lookup: () => command.property1, mapsTo: 'property1' },
          command,
          noAttributes,
          true
        )
      })

      it('should save the workflow as complete', () => {
        expect(state).toHaveLength(1)
        expect(state[0]).toMatchObject({
          $status: WorkflowStatus.Complete,
          property1: command.property1
        })
      })
    })

    describe('and a class workflow is registered in the same call', () => {
      it('should start the class workflow too', () => {
        expect(persistence.length(TestWorkflowStartedByCompletesData)).toEqual(
          1
        )
      })
    })

    describe('and its startedBy handler returns a copy of the state with other bus-managed fields', () => {
      let state: TestFunctionStartedByCopyState[]

      beforeAll(async () => {
        state = await persistence.getWorkflowState(
          TestFunctionStartedByCopyState,
          { lookup: () => command.property1, mapsTo: 'property1' },
          command,
          noAttributes
        )
      })

      it('should save the state with the fields it returned', () => {
        expect(state).toHaveLength(1)
        expect(state[0].property1).toEqual(command.property1)
      })

      it('should keep the $workflowId, $version and $name the bus manages', () => {
        expect(state[0].$workflowId).not.toEqual('not-the-workflow-id')
        expect(state[0].$version).toEqual(1)
        expect(state[0].$name).toEqual(TestFunctionStartedByCopyState.NAME)
      })
    })

    describe('and its startedBy handler discards the workflow', () => {
      it('should not save the workflow', () => {
        expect(persistence.length(TestFunctionStartedByDiscardState)).toEqual(0)
      })
    })

    describe('and its startedBy handler returns nothing', () => {
      it('should save the new workflow state', () => {
        expect(persistence.length(TestFunctionStartedByVoidState)).toEqual(1)
      })
    })

    describe('and then a message that maps to it by a custom lookup is received', () => {
      let finalState: TestFunctionWorkflowState[]

      beforeAll(async () => {
        // The TaskRan handler sends FinalTask, which carries the workflow id and so is routed back to the workflow
        const finalTaskHandled = handled(FinalTask.NAME)
        await bus.publish(new TaskRan(command.property1!), { correlationId })
        await finalTaskHandled
        finalState = await persistence.getWorkflowState(
          TestFunctionWorkflowState,
          byProperty1,
          command,
          noAttributes,
          true
        )
      })

      it('should complete the workflow when the message it sent is handled', () => {
        expect(finalState).toHaveLength(1)
        expect(finalState[0]).toMatchObject({
          $status: WorkflowStatus.Complete,
          $version: 3,
          finalTaskCorrelationId: correlationId
        })
      })
    })
  })

  describe('when a workflow declared with defineWorkflow has a state without message types', () => {
    let bus: BusInstance
    let initializeError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(messageTypesFor(TestCommand))
        .withWorkflow(
          defineWorkflow(TestFunctionStartedByVoidState).startedBy(
            TestCommand,
            () => undefined
          )
        )
        .build()
      initializeError = await bus.initialize().catch((error: unknown) => error)
    })

    afterAll(async () => bus.dispose())

    it('should throw MessageTypesMissing naming the workflow state', () => {
      expect(initializeError).toBeInstanceOf(MessageTypesMissing)
      expect((initializeError as MessageTypesMissing).missingNames).toEqual([
        TestFunctionStartedByVoidState.NAME
      ])
    })
  })
})
