import { MessageTypes, registerMessageTypes } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { MessageTypesMissing, Serializer } from '../serialization'
import { resetMessageTypes, TestCommand, TestEvent } from '../test'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'

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

const configure = () =>
  Bus.configure()
    .withLogger(() => Mock.ofType<Logger>().object)
    .withHandler(handlerFor(TestCommand, () => undefined))
    .withWorkflow(TestMessageTypesWorkflow)

const entry = { fields: {} }

/**
 * A serializer that doesn't use the registered message types
 */
const customSerializer: Serializer = {
  serialize: obj => JSON.stringify(obj),
  deserialize: (serialized, classType) =>
    Object.assign(new classType(), JSON.parse(serialized)),
  toPlain: obj => JSON.parse(JSON.stringify(obj)) as object,
  toClass: (obj, classType) => Object.assign(new classType(), obj)
}

/**
 * Registers only the given message types, then initializes a bus
 * @returns the bus, and what initialize() threw
 */
const initializeWith = async (
  messageTypes: MessageTypes[],
  configuration = configure()
): Promise<{ bus: BusInstance; error: unknown }> => {
  resetMessageTypes()
  messageTypes.forEach(registerMessageTypes)
  const bus = configuration.build()
  const error = await bus.initialize().then(
    () => undefined,
    (caught: unknown) => caught
  )
  return { bus, error }
}

describe('BusInstance', () => {
  afterAll(() => resetMessageTypes())

  describe('when initializing with message types registered', () => {
    describe('with an entry for every handled message and workflow state', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initializeWith([
          {
            source: 'library-a',
            messages: { [TestCommand.NAME]: 'TestCommand' },
            types: { TestCommand: entry }
          },
          // A second library, registered by its own generated file
          {
            source: 'library-b',
            messages: {
              [TestEvent.NAME]: 'TestEvent',
              [TestMessageTypesWorkflowState.NAME]:
                'TestMessageTypesWorkflowState'
            },
            types: { TestEvent: entry, TestMessageTypesWorkflowState: entry }
          }
        ]))
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
        ;({ bus, error: initializeError } = await initializeWith([
          {
            messages: { [TestEvent.NAME]: 'TestEvent' },
            types: { TestEvent: entry }
          }
        ]))
      })

      afterAll(async () => bus.dispose())

      it('should throw MessageTypesMissing listing every missing name', () => {
        expect(initializeError).toBeInstanceOf(MessageTypesMissing)
        expect((initializeError as MessageTypesMissing).missingNames).toEqual([
          TestCommand.NAME,
          TestMessageTypesWorkflowState.NAME
        ])
      })

      it('should say how to register them', () => {
        expect((initializeError as MessageTypesMissing).help).toContain(
          "import './message-types.generated'"
        )
      })
    })

    describe('with a custom serializer', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initializeWith(
          [
            {
              messages: { [TestEvent.NAME]: 'TestEvent' },
              types: { TestEvent: entry }
            }
          ],
          configure().withSerializer(customSerializer)
        ))
      })

      afterAll(async () => bus.dispose())

      it('should not check the registered message types', () => {
        expect(initializeError).toBeUndefined()
      })
    })
  })

  describe('when initializing without any message types registered', () => {
    let bus: BusInstance
    let initializeError: unknown

    beforeAll(async () => {
      ;({ bus, error: initializeError } = await initializeWith([]))
    })

    afterAll(async () => bus.dispose())

    it('should not check for them', () => {
      expect(initializeError).toBeUndefined()
    })
  })
})
