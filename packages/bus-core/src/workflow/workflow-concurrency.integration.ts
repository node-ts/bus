import { It, Mock, Times } from 'typemoq'
import { Handler, Workflow, WorkflowMapper, WorkflowState } from '../'
import { Bus, BusInstance } from '../service-bus'
import { ClassConstructor, sleep } from '../util'
import { InMemoryPersistence } from './persistence'
import {
  FinalTask,
  RunTask,
  TaskRan,
  TestCommand,
  TestWorkflowState
} from './test'
import { MessageAttributes } from '@node-ts/bus-messages'
import * as uuid from 'uuid'

jest.setTimeout(10_000)

describe('Workflow Concurrency', () => {
  const completeCallback =
    Mock.ofType<(workflowId: string, correlationId: string) => void>()

  class TestWorkflow extends Workflow<TestWorkflowState> {
    constructor(private bus: BusInstance) {
      super()
    }

    configureWorkflow(
      mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>
    ): void {
      mapper
        .withState(TestWorkflowState)
        .startedBy(TestCommand, 'step1')
        .when(TaskRan, 'step2', {
          lookup: message => message.value,
          mapsTo: 'property1'
        })
        .when(FinalTask, 'step3') // Maps on workflow id
    }

    async step1({ property1 }: TestCommand, _: any) {
      await this.bus.send(new RunTask(property1!))
      return { property1 }
    }

    async step2({ value }: TaskRan, state: TestWorkflowState) {
      await this.bus.send(new FinalTask())
      return { ...state, property1: value }
    }

    async step3(
      _: FinalTask,
      __: WorkflowState,
      {
        correlationId,
        stickyAttributes: { workflowId }
      }: MessageAttributes<{}, { workflowId: string }>
    ) {
      completeCallback.object(workflowId, correlationId!)
      return this.completeWorkflow()
    }
  }

  class RunTaskHandler implements Handler<RunTask> {
    messageType = RunTask

    constructor(private bus: BusInstance) {}

    async handle(message: RunTask) {
      await this.bus.publish(new TaskRan(message.value))
    }
  }

  const CONSUME_TIMEOUT = 5_000
  let bus: BusInstance
  const inMemoryPersistence = new InMemoryPersistence()
  const workflowsToInvoke = 100
  const correlationIds = new Array(workflowsToInvoke)
    .fill(undefined)
    .map(() => uuid.v4())

  beforeAll(async () => {
    bus = Bus.configure()
      .withPersistence(inMemoryPersistence)
      .withContainer({
        get<T>(ctor: ClassConstructor<T>) {
          return new ctor(bus)
        }
      })
      .withWorkflow(TestWorkflow)
      .withHandler(RunTaskHandler)
      .withConcurrency(10)
      .build()

    await bus.initialize()
    await bus.start()

    // Introduce sufficient parallelism to test for message handling context leakage
    const sendMessages = correlationIds.map(
      async (correlationId: string) =>
        await bus.send(new TestCommand(uuid.v4()), { correlationId })
    )
    await Promise.all(sendMessages)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    it('should complete the workflow', () => {
      correlationIds.forEach(correlationId =>
        completeCallback.verify(
          c =>
            c(
              It.is(workflowId => !!workflowId),
              correlationId
            ),
          Times.once()
        )
      )
    })
  })
})
