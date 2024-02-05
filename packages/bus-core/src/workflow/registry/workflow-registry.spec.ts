import { MessageAttributes } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { ContainerAdapter } from '../../container'
import { DefaultHandlerRegistry, Handler } from '../../handler'
import { DebugLogger } from '../../logger'
import { Bus, BusInstance } from '../../service-bus'
import { CoreDependencies, sleep } from '../../util'
import { InMemoryPersistence } from '../persistence'
import { FinalTask } from '../test/final-task'
import { TestWorkflow } from '../test/test-workflow'
import { WorkflowRegistry } from './workflow-registry'
import { InMemoryQueue } from '../../transport'
import { TestCommand } from '../test/test-command'
import { RunTaskHandler } from '../test/run-task-handler'

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

describe('WorkflowRegistry', () => {
  let sut: WorkflowRegistry
  let persistence = Mock.ofType(InMemoryPersistence)

  describe('when initializing', () => {
    beforeEach(() => {
      sut = new WorkflowRegistry()
      sut.register(TestWorkflow)
      sut.prepare(
        {
          loggerFactory: (name: string) => new DebugLogger(name)
        } as unknown as CoreDependencies,
        persistence.object
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
                It.is(attributes => !!attributes.stickyAttributes!.$workflowId)
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
