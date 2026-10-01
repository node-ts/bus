import { messageAttributes } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { Logger } from '../logger'
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
  TestFunctionStartedByDiscardState,
  testFunctionStartedByDiscardWorkflow,
  TestFunctionStartedByVoidState,
  testFunctionStartedByVoidWorkflow,
  testFunctionWorkflow,
  TestFunctionWorkflowState
} from './test'
import { WorkflowStatus } from './workflow-state'

/**
 * Resolves once the bus has handled a message named `name`
 */
const handled = (bus: BusInstance, name: string) =>
  new Promise<void>(resolve => {
    const unsubscribe = bus.afterDispatch.on(({ message }) => {
      if (message.$name === name) {
        unsubscribe()
        resolve()
      }
    })
  })

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
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withPersistence(persistence)
        .withWorkflow(
          testFunctionWorkflow,
          testFunctionStartedByCompletesWorkflow,
          testFunctionStartedByDiscardWorkflow,
          testFunctionStartedByVoidWorkflow
        )
        .build()
      await bus.initialize()
      await bus.start()

      const started = handled(bus, TestCommand.NAME)
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
        const finalTaskHandled = handled(bus, FinalTask.NAME)
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
