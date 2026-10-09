import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { IMock, It, Mock, Times } from 'typemoq'
import { ContainerAdapter } from '../../container'
import {
  DefaultHandlerRegistry,
  FunctionHandler,
  Handler,
  HandlerContext,
  HandlerDefinition,
  HandlerDispatchRejected,
  HandlerRegistry
} from '../../handler'
import { DebugLogger, Logger } from '../../logger'
import { MessageHandlingContext } from '../../message-handling-context'
import { MessageLifecycleContext } from '../../message-lifecycle-context'
import { UnitOfWorkContext } from '../../outbox/unit-of-work-context'
import { deadLetter } from '../../recoverability'
import { Bus, BusInstance } from '../../service-bus'
import { testMessageTypes } from '../../test'
import { InMemoryQueue } from '../../transport'
import { CoreDependencies, sleep } from '../../util'
import { FunctionWorkflow } from '../define-workflow'
import {
  WorkflowAlreadyStartedByMessage,
  WorkflowConfigurationFailed,
  WorkflowHandlerFailed,
  WorkflowMappingInvalid,
  WorkflowNameAlreadyRegistered,
  WorkflowNotRecognized,
  WorkflowRegisteredAfterInitialization,
  WorkflowStateNotProvided
} from '../error'
import { InMemoryPersistence, Persistence } from '../persistence'
import {
  TaskRan,
  testFunctionTimeoutWorkflow,
  TestFunctionTimeoutWorkflowState,
  testFunctionWorkflow,
  TestFunctionWorkflowState,
  TestPaymentTimedOut
} from '../test'
import { FinalTask } from '../test/final-task'
import { RunTaskHandler } from '../test/run-task-handler'
import { TestCommand } from '../test/test-command'
import { TestWorkflow } from '../test/test-workflow'
import { TestWorkflowState } from '../test/test-workflow-state'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowStatus } from '../workflow-state'
import { WorkflowRegistry } from './workflow-registry'

class TestFinalTaskHandler implements Handler<FinalTask> {
  messageType = FinalTask

  constructor(
    private readonly callback: (
      message: FinalTask,
      attributes: MessageAttributes
    ) => void
  ) {}

  async handle(
    message: FinalTask,
    attributes: MessageAttributes
  ): Promise<void> {
    this.callback(message, attributes)
  }
}

class StatelessWorkflow extends Workflow<TestWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestWorkflowState, StatelessWorkflow>
  ): void {
    mapper.startedBy(TestCommand, 'start')
  }

  start() {
    return {}
  }
}

const catchError = async (fn: () => unknown): Promise<unknown> => {
  try {
    await fn()
    return undefined
  } catch (error) {
    return error
  }
}

describe('WorkflowRegistry', () => {
  let sut: WorkflowRegistry
  const persistence = Mock.ofType(InMemoryPersistence)
  const coreDependencies = {
    loggerFactory: (name: string) => new DebugLogger(name)
  } as unknown as CoreDependencies

  describe('when registering a workflow after initializing', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(TestWorkflow)
      await sut.initialize(new DefaultHandlerRegistry(), undefined)
      error = await catchError(() => sut.register(StatelessWorkflow))
    })

    it('should throw WorkflowRegisteredAfterInitialization naming the workflow', () => {
      expect(error).toBeInstanceOf(WorkflowRegisteredAfterInitialization)
      expect(
        (error as WorkflowRegisteredAfterInitialization).workflowName
      ).toEqual('StatelessWorkflow')
      expect((error as WorkflowRegisteredAfterInitialization).help).toContain(
        'withWorkflow(StatelessWorkflow)'
      )
    })
  })

  describe('when registering two workflows with the same name', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new WorkflowRegistry()
      sut.register(TestWorkflow)
      error = await catchError(() => sut.register(TestWorkflow))
    })

    it('should throw WorkflowNameAlreadyRegistered naming the workflow', () => {
      expect(error).toBeInstanceOf(WorkflowNameAlreadyRegistered)
      expect((error as WorkflowNameAlreadyRegistered).workflowName).toEqual(
        'TestWorkflow'
      )
    })
  })

  describe('when initializing a workflow that does not declare its state', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(StatelessWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it('should throw WorkflowStateNotProvided naming the workflow and the fix', () => {
      expect(error).toBeInstanceOf(WorkflowStateNotProvided)
      expect((error as WorkflowStateNotProvided).message).toEqual(
        "Workflow StatelessWorkflow doesn't declare its state"
      )
      expect((error as WorkflowStateNotProvided).help).toContain(
        'mapper.withState('
      )
    })
  })

  describe('when initializing a class workflow', () => {
    let container: IMock<ContainerAdapter>
    let constructed: number

    beforeAll(async () => {
      constructed = 0
      class CountingWorkflow extends TestWorkflow {
        constructor(bus: BusInstance) {
          super(bus)
          constructed++
        }
      }
      container = Mock.ofType<ContainerAdapter>()
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(CountingWorkflow)
      await sut.initialize(new DefaultHandlerRegistry(), container.object)
    })

    it('should not construct the workflow', () => {
      expect(constructed).toEqual(0)
    })

    it('should not resolve the workflow from the container', () => {
      container.verify(c => c.get(It.isAny(), It.isAny()), Times.never())
    })

    it('should read its state from configureWorkflow', () => {
      expect(sut.getWorkflowStateNames()).toEqual([TestWorkflowState.NAME])
    })
  })

  describe('when a class workflow reads its fields in configureWorkflow', () => {
    let error: unknown

    beforeAll(async () => {
      class FieldReadingWorkflow extends Workflow<TestWorkflowState> {
        private readonly startedBy = { handler: 'start' as const }

        configureWorkflow(
          mapper: WorkflowMapper<TestWorkflowState, FieldReadingWorkflow>
        ): void {
          mapper
            .withState(TestWorkflowState)
            .startedBy(TestCommand, this.startedBy.handler)
        }

        start() {
          return {}
        }
      }
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(FieldReadingWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it('should throw WorkflowConfigurationFailed naming the workflow, with the error as its cause and the fix', () => {
      expect(error).toBeInstanceOf(WorkflowConfigurationFailed)
      const configurationFailed = error as WorkflowConfigurationFailed
      expect(configurationFailed.workflowName).toEqual('FieldReadingWorkflow')
      expect(configurationFailed.cause).toBeInstanceOf(TypeError)
      expect(configurationFailed.help).toContain(
        'without running its constructor'
      )
    })
  })

  describe('when a class workflow is started by a message twice in configureWorkflow', () => {
    let error: unknown

    beforeAll(async () => {
      class TwiceStartedWorkflow extends Workflow<TestWorkflowState> {
        configureWorkflow(
          mapper: WorkflowMapper<TestWorkflowState, TwiceStartedWorkflow>
        ): void {
          mapper
            .withState(TestWorkflowState)
            .startedBy(TestCommand, 'start')
            .startedBy(TestCommand, 'start')
        }

        start() {
          return {}
        }
      }
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(TwiceStartedWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it("should throw the mapper's own error", () => {
      expect(error).toBeInstanceOf(WorkflowAlreadyStartedByMessage)
    })
  })

  describe('when a class workflow reads a lookup from a field in configureWorkflow', () => {
    let error: unknown

    beforeAll(async () => {
      class FieldLookupWorkflow extends Workflow<TestWorkflowState> {
        private readonly byValue = (message: TaskRan) => message.value

        configureWorkflow(
          mapper: WorkflowMapper<TestWorkflowState, FieldLookupWorkflow>
        ): void {
          mapper
            .withState(TestWorkflowState)
            .startedBy(TestCommand, 'start')
            .when(TaskRan, 'ran', {
              lookup: this.byValue,
              mapsTo: 'property1'
            })
        }

        start() {
          return {}
        }

        ran() {
          return {}
        }
      }
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(FieldLookupWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it('should throw WorkflowConfigurationFailed, caused by WorkflowMappingInvalid naming the lookup', () => {
      expect(error).toBeInstanceOf(WorkflowConfigurationFailed)
      const cause = (error as WorkflowConfigurationFailed).cause
      expect(cause).toBeInstanceOf(WorkflowMappingInvalid)
      expect((cause as WorkflowMappingInvalid).workflowName).toEqual(
        'FieldLookupWorkflow'
      )
      expect((cause as WorkflowMappingInvalid).mapperMethod).toEqual('when')
      expect((cause as WorkflowMappingInvalid).problem).toEqual(
        "a lookup whose lookup isn't a function"
      )
      expect((error as WorkflowConfigurationFailed).help).toEqual(
        (cause as WorkflowMappingInvalid).help
      )
    })
  })

  describe('when a class workflow reads a handler name from a field in configureWorkflow', () => {
    let error: unknown

    beforeAll(async () => {
      class FieldHandlerNameWorkflow extends Workflow<TestWorkflowState> {
        private readonly startHandler = 'start' as const

        configureWorkflow(
          mapper: WorkflowMapper<TestWorkflowState, FieldHandlerNameWorkflow>
        ): void {
          mapper
            .withState(TestWorkflowState)
            .startedBy(TestCommand, this.startHandler)
        }

        start() {
          return {}
        }
      }
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(FieldHandlerNameWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it('should throw WorkflowConfigurationFailed, caused by WorkflowMappingInvalid naming the handler name', () => {
      expect(error).toBeInstanceOf(WorkflowConfigurationFailed)
      const cause = (error as WorkflowConfigurationFailed).cause
      expect(cause).toBeInstanceOf(WorkflowMappingInvalid)
      expect((cause as WorkflowMappingInvalid).mapperMethod).toEqual(
        'startedBy'
      )
      expect((cause as WorkflowMappingInvalid).problem).toContain(
        "a handler name that isn't a string"
      )
    })
  })

  describe('when a class workflow declares configureWorkflow as an arrow function property', () => {
    let error: unknown

    beforeAll(async () => {
      class ArrowConfiguredWorkflow extends Workflow<TestWorkflowState> {
        configureWorkflow: (
          mapper: WorkflowMapper<TestWorkflowState, ArrowConfiguredWorkflow>
        ) => void = mapper => {
          mapper.withState(TestWorkflowState).startedBy(TestCommand, 'start')
        }

        start() {
          return {}
        }
      }
      sut = new WorkflowRegistry()
      sut.prepare(
        coreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      sut.register(ArrowConfiguredWorkflow)
      error = await catchError(() =>
        sut.initialize(new DefaultHandlerRegistry(), undefined)
      )
    })

    it('should throw WorkflowConfigurationFailed, saying to declare it as a method', () => {
      expect(error).toBeInstanceOf(WorkflowConfigurationFailed)
      const configurationFailed = error as WorkflowConfigurationFailed
      expect(configurationFailed.workflowName).toEqual(
        'ArrowConfiguredWorkflow'
      )
      expect(configurationFailed.message).not.toContain('unconstructed')
      expect(configurationFailed.help).toContain('as a method')
    })
  })

  describe('when the container fails to resolve a class workflow for a message', () => {
    const containerError = new Error('Workflow is not bound')
    const errors = new EventEmitter()
    const queue = new InMemoryQueue()
    let bus: BusInstance
    let dispatchError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withWorkflow(TestWorkflow)
        .withContainer({
          get: () => {
            throw containerError
          }
        })
        .withTransport(queue)
        .withRecoverability(() => deadLetter())
        .withMiddleware({
          incoming: async (_, next) => {
            try {
              await next()
            } catch (error) {
              errors.emit('failed', error)
              throw error
            }
          }
        })
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(errors, 'failed')
      await bus.send(new TestCommand('abc'))
      ;[dispatchError] = await failed
    })

    afterAll(async () => bus.dispose())

    it('should fail the message with WorkflowHandlerFailed, keeping the container error as its cause', () => {
      expect(dispatchError).toBeInstanceOf(HandlerDispatchRejected)
      const [rejection] = (dispatchError as HandlerDispatchRejected).rejections
      expect(rejection).toBeInstanceOf(WorkflowHandlerFailed)
      expect((rejection as WorkflowHandlerFailed).workflowName).toEqual(
        'TestWorkflow'
      )
      expect((rejection as WorkflowHandlerFailed).cause).toBe(containerError)
    })
  })

  describe('when a workflow declared with defineWorkflow is initialized', () => {
    let handlerRegistry: DefaultHandlerRegistry
    let functionPersistence: IMock<InMemoryPersistence>

    beforeEach(async () => {
      functionPersistence = Mock.ofType(InMemoryPersistence)
      handlerRegistry = new DefaultHandlerRegistry()
      sut = new WorkflowRegistry()
      sut.register(testFunctionWorkflow)
      sut.prepare(
        {
          loggerFactory: (name: string) => new DebugLogger(name)
        } as unknown as CoreDependencies,
        functionPersistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      await sut.initialize(handlerRegistry, undefined)
    })

    it('should register a handler for each message it handles', () => {
      expect(handlerRegistry.getMessageNames()).toEqual(
        expect.arrayContaining([TestCommand.NAME, TaskRan.NAME, FinalTask.NAME])
      )
    })

    it('should record how its state is stored, with its lookups', () => {
      const [persistedWorkflow] = sut.getPersistedWorkflows()
      expect(persistedWorkflow.workflowStateType).toEqual(
        TestFunctionWorkflowState
      )
      expect(
        persistedWorkflow.messageWorkflowMappings.map(m => m.mapsTo)
      ).toEqual(['property1', '$workflowId'])
    })

    it('should report the $name of its state', () => {
      expect(sut.getWorkflowStateNames()).toEqual([
        TestFunctionWorkflowState.NAME
      ])
    })
  })

  describe('when a workflow object built by hand is registered', () => {
    let error: unknown

    beforeEach(() => {
      sut = new WorkflowRegistry()
      try {
        sut.register({
          name: 'hand-built'
        } as unknown as FunctionWorkflow<TestFunctionWorkflowState>)
      } catch (e) {
        error = e
      }
    })

    it('should throw WorkflowNotRecognized', () => {
      expect(error).toBeInstanceOf(WorkflowNotRecognized)
    })
  })

  describe('when a workflow declared with defineWorkflow is registered twice', () => {
    let error: unknown

    beforeEach(() => {
      sut = new WorkflowRegistry()
      sut.register(testFunctionWorkflow)
      try {
        sut.register(testFunctionWorkflow)
      } catch (e) {
        error = e
      }
    })

    it('should throw WorkflowNameAlreadyRegistered naming the state', () => {
      expect(error).toBeInstanceOf(WorkflowNameAlreadyRegistered)
      expect((error as WorkflowNameAlreadyRegistered).workflowName).toEqual(
        TestFunctionWorkflowState.NAME
      )
    })
  })

  describe('when a message finds no running workflow instance', () => {
    const COMPLETED_LOG =
      'Workflow instance for message has already completed. Ignoring.'
    const NOT_FOUND_LOG = 'No workflow instance found for message. Ignoring.'
    const timeout = TestPaymentTimedOut({ orderId: 'order-1' })
    const attributes = messageAttributes({
      stickyAttributes: { workflowId: 'workflow-1' }
    })
    let logger: IMock<Logger>
    let timeoutPersistence: IMock<Persistence>

    const workflowState = (
      $workflowId: string,
      $status: WorkflowStatus
    ): TestFunctionTimeoutWorkflowState =>
      Object.assign(new TestFunctionTimeoutWorkflowState(), {
        $workflowId,
        $status,
        $version: 2,
        orderId: 'order-1',
        paid: true,
        timedOutOrderId: undefined
      })

    /**
     * Initializes a registry for `testFunctionTimeoutWorkflow`, and handles a timeout with the handler it registers
     * @param stateIncludingCompleted what the persistence finds when it's asked for completed instances too
     * @param timeoutAttributes the attributes the timeout arrives with
     */
    const handleTimeout = async (
      stateIncludingCompleted: TestFunctionTimeoutWorkflowState[],
      timeoutAttributes: MessageAttributes = attributes
    ): Promise<void> => {
      logger = Mock.ofType<Logger>()
      timeoutPersistence = Mock.ofType<Persistence>()
      timeoutPersistence
        .setup(p =>
          p.getWorkflowState(
            It.isAny(),
            It.isAny(),
            It.isAny(),
            It.isAny(),
            false
          )
        )
        .returns(async () => [])
      timeoutPersistence
        .setup(p =>
          p.getWorkflowState(
            It.isAny(),
            It.isAny(),
            It.isAny(),
            It.isAny(),
            true
          )
        )
        .returns(async () => stateIncludingCompleted)

      const handlers = new Map<string, HandlerDefinition>()
      const handlerRegistry = Mock.ofType<HandlerRegistry>()
      handlerRegistry
        .setup(r => r.register(It.isAny(), It.isAny()))
        .callback((messageType: { NAME: string }, handler) =>
          handlers.set(messageType.NAME, handler)
        )

      sut = new WorkflowRegistry()
      sut.register(testFunctionTimeoutWorkflow)
      sut.prepare(
        {
          loggerFactory: () => logger.object
        } as unknown as CoreDependencies,
        timeoutPersistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext(),
        new UnitOfWorkContext()
      )
      await sut.initialize(handlerRegistry.object, undefined)

      const handler = handlers.get(
        TestPaymentTimedOut.NAME
      ) as FunctionHandler<TestPaymentTimedOut>
      await handler(
        timeout,
        timeoutAttributes,
        Mock.ofType<HandlerContext>().object
      )
    }

    describe('and its instance has completed', () => {
      beforeAll(async () => {
        await handleTimeout([
          workflowState('workflow-1', WorkflowStatus.Complete)
        ])
      })

      it('should look for completed instances after finding no running one', () => {
        timeoutPersistence.verify(
          p =>
            p.getWorkflowState(
              TestFunctionTimeoutWorkflowState,
              It.isAny(),
              timeout,
              attributes,
              true
            ),
          Times.once()
        )
      })

      it('should ignore the message and log it at debug with its mapping', () => {
        logger.verify(
          l =>
            l.debug(
              COMPLETED_LOG,
              It.isObjectWith({
                messageName: TestPaymentTimedOut.NAME,
                workflowName: TestFunctionTimeoutWorkflowState.NAME,
                mapsTo: '$workflowId',
                lookupValue: 'workflow-1',
                completedInstances: 1,
                workflowIds: ['workflow-1']
              })
            ),
          Times.once()
        )
      })

      it('should not log a warning or an error', () => {
        logger.verify(l => l.warn(It.isAny(), It.isAny()), Times.never())
        logger.verify(l => l.error(It.isAny(), It.isAny()), Times.never())
      })
    })

    describe('and it matches many completed instances', () => {
      const workflowIds = Array.from(
        { length: 7 },
        (_, index) => `workflow-${index}`
      )

      beforeAll(async () => {
        await handleTimeout(
          workflowIds.map(id => workflowState(id, WorkflowStatus.Complete))
        )
      })

      it('should log how many there are, and the ids of the first 5 only', () => {
        logger.verify(
          l =>
            l.debug(
              COMPLETED_LOG,
              It.isObjectWith({
                completedInstances: 7,
                workflowIds: workflowIds.slice(0, 5)
              })
            ),
          Times.once()
        )
      })
    })

    describe('and no instance of it was ever started', () => {
      beforeAll(async () => {
        await handleTimeout([])
      })

      it('should ignore the message and log a warning naming the workflow, the mapping and the fix', () => {
        logger.verify(
          l =>
            l.warn(
              NOT_FOUND_LOG,
              It.is<Record<string, unknown>>(
                context =>
                  context.messageName === TestPaymentTimedOut.NAME &&
                  context.workflowName ===
                    TestFunctionTimeoutWorkflowState.NAME &&
                  context.mapsTo === '$workflowId' &&
                  context.lookupValue === 'workflow-1' &&
                  typeof context.help === 'string'
              )
            ),
          Times.once()
        )
      })

      it('should not log it as completed', () => {
        logger.verify(l => l.debug(COMPLETED_LOG, It.isAny()), Times.never())
      })
    })

    describe('and an instance started after the first query', () => {
      beforeAll(async () => {
        await handleTimeout([
          workflowState('workflow-1', WorkflowStatus.Running)
        ])
      })

      it('should not log it as completed', () => {
        logger.verify(l => l.debug(COMPLETED_LOG, It.isAny()), Times.never())
      })

      it('should log a warning', () => {
        logger.verify(l => l.warn(NOT_FOUND_LOG, It.isAny()), Times.once())
      })
    })

    describe('and its lookup finds no value', () => {
      beforeAll(async () => {
        await handleTimeout(
          [workflowState('workflow-1', WorkflowStatus.Complete)],
          messageAttributes()
        )
      })

      it('should not look for completed instances', () => {
        timeoutPersistence.verify(
          p =>
            p.getWorkflowState(
              It.isAny(),
              It.isAny(),
              It.isAny(),
              It.isAny(),
              true
            ),
          Times.never()
        )
      })

      it('should log a warning', () => {
        logger.verify(
          l =>
            l.warn(
              NOT_FOUND_LOG,
              It.is<Record<string, unknown>>(
                context => 'lookupValue' in context && !context.lookupValue
              )
            ),
          Times.once()
        )
      })
    })
  })

  describe('when a message is sent from a workflow', () => {
    let container: IMock<ContainerAdapter>
    let callback: IMock<
      (message: FinalTask, attributes: MessageAttributes) => void
    >
    let completionCallback: IMock<() => void>
    let bus: BusInstance

    beforeAll(async () => {
      callback =
        Mock.ofType<
          (message: FinalTask, attributes: MessageAttributes) => void
        >()
      completionCallback = Mock.ofType<() => void>()

      container = Mock.ofType<ContainerAdapter>()

      container
        .setup(c => c.get(TestFinalTaskHandler, It.isAny()))
        .returns(() => new TestFinalTaskHandler(callback.object))

      container
        .setup(c => c.get(RunTaskHandler, It.isAny()))
        .returns(() => new RunTaskHandler(bus))

      container
        .setup(c => c.get(TestWorkflow, It.isAny()))
        .returns(() => new TestWorkflow(bus, completionCallback.object))

      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withWorkflow(TestWorkflow)
        .withHandler(TestFinalTaskHandler, RunTaskHandler)
        .withContainer(container.object)
        .withTransport(new InMemoryQueue())
        .withPersistence(new InMemoryPersistence())
        .build()

      await bus.initialize()
      await bus.start()

      await bus.send(new TestCommand('abc'))
    })

    afterAll(async () => {
      await bus.stop()
    })

    it('should attach the $workflowId to stickyAttributes of incoming/outgoing messages', async () => {
      while (true) {
        try {
          // Poll for the callback to be invoked
          callback.verify(
            cb =>
              cb(
                It.isAny(),
                It.is(attributes => !!attributes.stickyAttributes!.workflowId)
              ),
            Times.once()
          )
          break
        } catch {
          await sleep(100)
        }
      }
    })

    it('should trigger workflow steps looked up by $workflowId in stickyAttributes', async () => {
      while (true) {
        try {
          // Poll for the completion callback to be invoked
          completionCallback.verify(cb => cb(), Times.once())
          break
        } catch {
          await sleep(100)
        }
      }
    })
  })
})
