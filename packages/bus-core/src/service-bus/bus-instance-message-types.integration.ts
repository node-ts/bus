import { MessageTypes } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { JsonSerializer, MessageTypesMissing } from '../serialization'
import { TestCommand, TestEvent } from '../test'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { MessageTypesWithCustomSerializer } from './error'

class TestMessageTypesWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-message-types-workflow-state'
  $name = TestMessageTypesWorkflowState.NAME
}

class TestMessageTypesWorkflow extends Workflow<TestMessageTypesWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<
      TestMessageTypesWorkflowState,
      TestMessageTypesWorkflow
    >
  ): void {
    mapper
      .withState(TestMessageTypesWorkflowState)
      .startedBy(TestEvent, 'start')
  }

  start(): Partial<TestMessageTypesWorkflowState> {
    return {}
  }
}

const configure = (messageTypes: MessageTypes) =>
  Bus.configure()
    .withLogger(() => Mock.ofType<Logger>().object)
    .withMessageTypes(messageTypes)
    .withHandler(handlerFor(TestCommand, () => undefined))
    .withWorkflow(TestMessageTypesWorkflow)

const entry = { fields: {} }

describe('BusInstance', () => {
  describe('when initializing with message types', () => {
    describe('with an entry for every handled message and workflow state', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        bus = configure({
          messages: {
            [TestCommand.NAME]: 'TestCommand',
            [TestEvent.NAME]: 'TestEvent',
            [TestMessageTypesWorkflowState.NAME]:
              'TestMessageTypesWorkflowState'
          },
          types: {
            TestCommand: entry,
            TestEvent: entry,
            TestMessageTypesWorkflowState: entry
          }
        }).build()
        initializeError = await bus.initialize().then(
          () => undefined,
          (error: unknown) => error
        )
      })

      afterAll(async () => bus.dispose())

      it('should initialize', () => {
        expect(initializeError).toBeUndefined()
      })
    })

    describe('without entries for some of them', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        bus = configure({
          messages: { [TestEvent.NAME]: 'TestEvent' },
          types: { TestEvent: entry }
        }).build()
        initializeError = await bus.initialize().then(
          () => undefined,
          (error: unknown) => error
        )
      })

      afterAll(async () => bus.dispose())

      it('should throw MessageTypesMissing listing every missing name', () => {
        expect(initializeError).toBeInstanceOf(MessageTypesMissing)
        expect((initializeError as MessageTypesMissing).missingNames).toEqual([
          TestCommand.NAME,
          TestMessageTypesWorkflowState.NAME
        ])
      })
    })
  })

  describe('when building with message types and a custom serializer', () => {
    it('should throw MessageTypesWithCustomSerializer', () => {
      expect(() =>
        configure({ messages: {}, types: {} })
          .withSerializer(new JsonSerializer())
          .build()
      ).toThrow(MessageTypesWithCustomSerializer)
    })
  })
})
