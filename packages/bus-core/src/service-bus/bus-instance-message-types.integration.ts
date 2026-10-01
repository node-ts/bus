import { MessageTypes, MessageTypesConflict } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { MessageTypesMissing, Serializer } from '../serialization'
import { TestCommand, TestEvent } from '../test'
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

const libraryA: MessageTypes = {
  source: 'library-a',
  messages: { [TestCommand.NAME]: 'TestCommand' },
  types: { TestCommand: entry }
}

const libraryB: MessageTypes = {
  source: 'library-b',
  messages: {
    [TestEvent.NAME]: 'TestEvent',
    [TestMessageTypesWorkflowState.NAME]: 'TestMessageTypesWorkflowState'
  },
  types: { TestEvent: entry, TestMessageTypesWorkflowState: entry }
}

const onlyTestEvent: MessageTypes = {
  messages: { [TestEvent.NAME]: 'TestEvent' },
  types: { TestEvent: entry }
}

/**
 * A serializer that doesn't use message types
 */
const customSerializer: Serializer = {
  serialize: obj => JSON.stringify(obj),
  deserialize: (serialized, classType) =>
    Object.assign(new classType(), JSON.parse(serialized)),
  toPlain: obj => JSON.parse(JSON.stringify(obj)) as object,
  toClass: (obj, classType) => Object.assign(new classType(), obj)
}

/**
 * Builds and initializes a bus
 * @returns the bus, and what initialize() threw
 */
const initialize = async (
  configuration: ReturnType<typeof configure>
): Promise<{ bus: BusInstance; error: unknown }> => {
  const bus = configuration.build()
  const error = await bus.initialize().then(
    () => undefined,
    (caught: unknown) => caught
  )
  return { bus, error }
}

describe('BusInstance', () => {
  describe('when initializing with message types', () => {
    describe('with an entry for every handled message and workflow state', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(
          configure().withMessageTypes(libraryA, libraryB)
        ))
      })

      afterAll(async () => bus.dispose())

      it('should initialize', () => {
        expect(initializeError).toBeUndefined()
      })
    })

    describe('with the entries passed over several calls', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(
          configure().withMessageTypes(libraryA).withMessageTypes(libraryB)
        ))
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
        ;({ bus, error: initializeError } = await initialize(
          configure().withMessageTypes(onlyTestEvent)
        ))
      })

      afterAll(async () => bus.dispose())

      it('should throw MessageTypesMissing listing every missing name', () => {
        expect(initializeError).toBeInstanceOf(MessageTypesMissing)
        expect((initializeError as MessageTypesMissing).missingNames).toEqual([
          TestCommand.NAME,
          TestMessageTypesWorkflowState.NAME
        ])
      })

      it('should say how to pass them to the bus', () => {
        expect((initializeError as MessageTypesMissing).help).toContain(
          '.withMessageTypes(messageTypes)'
        )
      })
    })

    describe('with a custom serializer', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(
          configure()
            .withSerializer(customSerializer)
            .withMessageTypes(onlyTestEvent)
        ))
      })

      afterAll(async () => bus.dispose())

      it('should still check the message types', () => {
        expect(initializeError).toBeInstanceOf(MessageTypesMissing)
      })
    })
  })

  describe('when initializing without message types', () => {
    describe('with handlers and workflows', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(configure()))
      })

      afterAll(async () => bus.dispose())

      it('should throw MessageTypesMissing listing every handled name', () => {
        expect(initializeError).toBeInstanceOf(MessageTypesMissing)
        expect((initializeError as MessageTypesMissing).missingNames).toEqual([
          TestCommand.NAME,
          TestEvent.NAME,
          TestMessageTypesWorkflowState.NAME
        ])
      })
    })

    describe('with a send-only bus', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(
          configure().asSendOnly()
        ))
      })

      afterAll(async () => bus.dispose())

      it('should not check for them', () => {
        expect(initializeError).toBeUndefined()
      })
    })

    describe('without handlers or workflows', () => {
      let bus: BusInstance
      let initializeError: unknown

      beforeAll(async () => {
        ;({ bus, error: initializeError } = await initialize(
          Bus.configure().withLogger(() => Mock.ofType<Logger>().object)
        ))
      })

      afterAll(async () => bus.dispose())

      it('should not check for them', () => {
        expect(initializeError).toBeUndefined()
      })
    })
  })

  describe('when building with message types that map a $name to different types', () => {
    let buildError: unknown

    beforeAll(() => {
      try {
        configure()
          .withMessageTypes(libraryA, {
            source: 'library-c',
            messages: { [TestCommand.NAME]: 'OtherCommand' },
            types: { OtherCommand: entry }
          })
          .build()
      } catch (error) {
        buildError = error
      }
    })

    it('should throw MessageTypesConflict naming both libraries', () => {
      expect(buildError).toBeInstanceOf(MessageTypesConflict)
      expect((buildError as MessageTypesConflict).sources).toEqual([
        'library-a',
        'library-c'
      ])
    })
  })
})
