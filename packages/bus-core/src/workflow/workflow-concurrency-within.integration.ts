import { MessageAttributes } from '@node-ts/bus-messages'
import { It, Mock, Times } from 'typemoq'
import * as uuid from 'uuid'
import { Handler, Workflow, WorkflowMapper, WorkflowState } from '..'
import { Bus, BusInstance } from '../service-bus'
import { ClassConstructor, sleep } from '../util'
import { InMemoryPersistence } from './persistence'
import { FinalTask, RunTask, TaskRan, TestCommand } from './test'
import { TestWorkflowHighConcurrencyState } from './test/test-workflow-high-concurrency-state'
const theCorrelationId = uuid.v4()

jest.setTimeout(10_000)

describe('Workflow Concurrency', () => {
  const completeCallback =
    Mock.ofType<(workflowId: string, correlationId: string) => void>()

  const busMessagesSent = Mock.ofType<(id: string) => void>()

  class TestWorkflow extends Workflow<TestWorkflowHighConcurrencyState> {
    constructor(private bus: BusInstance) {
      super()
    }

    configureWorkflow(
      mapper: WorkflowMapper<TestWorkflowHighConcurrencyState, TestWorkflow>
    ): void {
      mapper
        .withState(TestWorkflowHighConcurrencyState)
        .startedBy(TestCommand, 'step1')
        .when(TaskRan, 'step2', {
          lookup: message => message.correlationId,
          mapsTo: 'correlationId'
        })
        .when(FinalTask, 'step3') // Maps on workflow id
    }

    async step1({ property1 }: TestCommand, _: any) {
      const batch = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(x =>
        x.toString()
      )
      // fire off 10 messages to simulate high concurrency
      const initialBatch = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(x =>
        x.toString()
      )
      await Promise.all(
        initialBatch.map(async (id: string) => {
          this.bus.send(new RunTask(id, theCorrelationId))
          busMessagesSent.object(id)
        })
      )
      return {
        property1,
        correlationId: theCorrelationId,
        idsToRun: batch,
        idsInFlight: initialBatch,
        idsCompleted: []
      }
    }

    async step2(
      { value, correlationId }: TaskRan,
      state: TestWorkflowHighConcurrencyState
    ) {
      const { idsInFlight, idsToRun } = state
      // A task has completed, lets keep concurrency at 10 and fire off another RunTask
      // Removes the first element from the state queue, updating it with the rest intact.
      const [nextId, ...remainingIds] = idsToRun
      const currentlyInFlight = idsInFlight.filter(id => id !== value)

      const nextState = {
        idsToRun: remainingIds,
        idsInFlight:
          nextId !== undefined
            ? currentlyInFlight.concat(nextId)
            : currentlyInFlight
      }

      if (nextId !== undefined) {
        await this.bus.send(new RunTask(nextId, correlationId))
        busMessagesSent.object(nextId)
      } else if (currentlyInFlight.length > 0) {
        return nextState
      } else {
        await this.bus.send(new FinalTask())
        return nextState
      }
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
      await this.bus.publish(new TaskRan(message.value, message.correlationId))
    }
  }

  const CONSUME_TIMEOUT = 5_000
  let bus: BusInstance
  const inMemoryPersistence = new InMemoryPersistence()

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
    await bus.send(new TestCommand(uuid.v4()), {
      correlationId: theCorrelationId
    })
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    it('should complete the workflow', () => {
      // Verify that this mock is called with anything, but exactly 20 times
      busMessagesSent.verify(c => c(It.isAny()), Times.exactly(20))
      completeCallback.verify(
        c =>
          c(
            It.is(workflowId => !!workflowId),
            theCorrelationId
          ),
        Times.once()
      )
    })
  })
})
