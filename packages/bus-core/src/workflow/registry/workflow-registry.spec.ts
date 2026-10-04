import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { ContainerAdapter } from '../../container'
import {
  DefaultHandlerRegistry,
  FunctionHandler,
  Handler,
  HandlerContext,
  HandlerDefinition,
  HandlerRegistry
} from '../../handler'
import { DebugLogger, Logger } from '../../logger'
import { MessageHandlingContext } from '../../message-handling-context'
import { MessageLifecycleContext } from '../../message-lifecycle-context'
import { Bus, BusInstance } from '../../service-bus'
import { testMessageTypes } from '../../test'
import { InMemoryQueue } from '../../transport'
import { CoreDependencies, sleep } from '../../util'
import { FunctionWorkflow } from '../define-workflow'
import {
  WorkflowNameAlreadyRegistered,
  WorkflowNotRecognized,
  WorkflowRegisteredAfterInitialization,
  WorkflowStateNotProvided
} from '../error'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
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
        new MessageLifecycleContext()
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
        new MessageLifecycleContext()
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

  describe('when initializing', () => {
    beforeEach(() => {
      sut = new WorkflowRegistry()
      sut.register(TestWorkflow)
      sut.prepare(
        {
          loggerFactory: (name: string) => new DebugLogger(name)
        } as unknown as CoreDependencies,
        persistence.object,
        new MessageHandlingContext(),
        new MessageLifecycleContext()
      )
    })

    describe('without a container', () => {
      it('should construct workflow instances', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), undefined)
      })
    })

    describe('with a container', () => {
      let container: IMock<ContainerAdapter>

      beforeEach(() => {
        container = Mock.ofType<ContainerAdapter>()
        container
          .setup(c => c.get(TestWorkflow))
          .returns(() => new TestWorkflow(Mock.ofType<BusInstance>().object))
          .verifiable(Times.once())
      })

      it('should fetch workflows from the container', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), container.object)
        container.verifyAll()
      })
    })
    describe('with an async container', () => {
      let container: IMock<ContainerAdapter>

      beforeEach(() => {
        container = Mock.ofType<ContainerAdapter>()
        container
          .setup(c => c.get(TestWorkflow))
          .returns(() =>
            Promise.resolve(new TestWorkflow(Mock.ofType<BusInstance>().object))
          )
          .verifiable(Times.once())
      })

      it('should fetch workflows from the container', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), container.object)
        container.verifyAll()
      })
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
        new MessageLifecycleContext()
      )
      await sut.initialize(handlerRegistry, undefined)
    })

    it('should register a handler for each message it handles', () => {
      expect(handlerRegistry.getMessageNames()).toEqual(
        expect.arrayContaining([TestCommand.NAME, TaskRan.NAME, FinalTask.NAME])
      )
    })

    it('should initialize its state in the persistence with its lookups', () => {
      functionPersistence.verify(
        p =>
          p.initializeWorkflow(
            TestFunctionWorkflowState,
            It.is<MessageWorkflowMapping[]>(
              mappings =>
                mappings.map(m => m.mapsTo).join() === 'property1,$workflowId'
            )
          ),
        Times.once()
      )
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
    const timeout = TestPaymentTimedOut({ orderId: 'order-1' })
    const attributes = messageAttributes({
      stickyAttributes: { workflowId: 'workflow-1' }
    })
    let logger: IMock<Logger>
    let timeoutPersistence: IMock<Persistence>

    /**
     * Initializes a registry for `testFunctionTimeoutWorkflow`, and handles a timeout with the handler it registers
     * @param completedWorkflowState what the persistence finds when it's asked for completed instances too
     */
    const handleTimeout = async (
      completedWorkflowState: TestFunctionTimeoutWorkflowState[]
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
        .returns(async () => completedWorkflowState)

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
        new MessageLifecycleContext()
      )
      await sut.initialize(handlerRegistry.object, undefined)

      const handler = handlers.get(
        TestPaymentTimedOut.NAME
      ) as FunctionHandler<TestPaymentTimedOut>
      await handler(timeout, attributes, Mock.ofType<HandlerContext>().object)
    }

    describe('and its instance has completed', () => {
      beforeAll(async () => {
        const completedState = Object.assign(
          new TestFunctionTimeoutWorkflowState(),
          {
            $workflowId: 'workflow-1',
            $status: WorkflowStatus.Complete,
            $version: 2,
            orderId: 'order-1',
            paid: true,
            timedOutOrderId: undefined
          }
        )
        await handleTimeout([completedState])
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

      it('should ignore the message and log it at debug', () => {
        logger.verify(
          l =>
            l.debug(
              'Workflow instance for message has already completed. Ignoring.',
              It.isObjectWith({ workflowIds: ['workflow-1'] })
            ),
          Times.once()
        )
      })

      it('should not log a warning or an error', () => {
        logger.verify(l => l.warn(It.isAny(), It.isAny()), Times.never())
        logger.verify(l => l.error(It.isAny(), It.isAny()), Times.never())
      })
    })

    describe('and no instance of it was ever started', () => {
      beforeAll(async () => {
        await handleTimeout([])
      })

      it('should ignore the message and log a warning naming the workflow', () => {
        logger.verify(
          l =>
            l.warn(
              'No workflow instance found for message. Ignoring.',
              It.isObjectWith({
                workflowName: TestFunctionTimeoutWorkflowState.NAME
              })
            ),
          Times.once()
        )
      })

      it('should not log it as completed', () => {
        logger.verify(
          l =>
            l.debug(
              'Workflow instance for message has already completed. Ignoring.',
              It.isAny()
            ),
          Times.never()
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
