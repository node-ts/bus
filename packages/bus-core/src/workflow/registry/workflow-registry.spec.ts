import { MessageAttributes } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { ContainerAdapter } from '../../container'
import { DefaultHandlerRegistry, Handler } from '../../handler'
import { DebugLogger } from '../../logger'
import { MessageHandlingContext } from '../../message-handling-context'
import { Bus, BusInstance } from '../../service-bus'
import { testMessageTypes } from '../../test'
import { InMemoryQueue } from '../../transport'
import { CoreDependencies, sleep } from '../../util'
import {
  WorkflowNameAlreadyRegistered,
  WorkflowRegisteredAfterInitialization,
  WorkflowStateNotProvided
} from '../error'
import { InMemoryPersistence } from '../persistence'
import { FinalTask } from '../test/final-task'
import { RunTaskHandler } from '../test/run-task-handler'
import { TestCommand } from '../test/test-command'
import { TestWorkflow } from '../test/test-workflow'
import { TestWorkflowState } from '../test/test-workflow-state'
import { Workflow, WorkflowMapper } from '../workflow'
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
        new MessageHandlingContext()
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
        new MessageHandlingContext()
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
        new MessageHandlingContext()
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
