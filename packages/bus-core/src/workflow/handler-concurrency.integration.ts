import { It, Mock, Times } from 'typemoq'
import { Handler, Workflow, WorkflowMapper, WorkflowState } from '../'
import { Bus, BusInstance } from '../service-bus'
import { ClassConstructor, sleep } from '../util'
import { InMemoryPersistence } from './persistence'
import { FinalTask, RunTask, TaskRan, TestCommand } from './test'
import { Command, MessageAttributes } from '@node-ts/bus-messages'
import * as uuid from 'uuid'

jest.setTimeout(10_000)

class HandlerTestWorkflowState extends WorkflowState {
  static NAME = 'HandlerTestWorkflowState'
  $name = HandlerTestWorkflowState.NAME

  property1: string
  eventValue: string
  listIds: number[]
}

/**
 * This intention of this test is to illustrate that no collisions occur when a singular workflow
 * batch sends many commands to be processed concurrently. In particular, when a command fails to
 * update state and an error occurs, the failing message that becomes visible again should not collide
 * nor spawn further commands that may lead to the repeat processing of commands.
 */
describe('Handler Concurrency', () => {
  const completeCallback =
    Mock.ofType<(workflowId: string, correlationId: string) => void>()

  class TestWorkflow extends Workflow<HandlerTestWorkflowState> {
    listIds: number[]
    static step2Counter = 0

    constructor(private bus: BusInstance) {
      super()
    }

    configureWorkflow(
      mapper: WorkflowMapper<HandlerTestWorkflowState, TestWorkflow>
    ): void {
      mapper
        .withState(HandlerTestWorkflowState)
        .startedBy(TestCommand, 'step1')
        .when(TaskRan, 'step2', {
          lookup: message => message.value,
          mapsTo: 'property1'
        })
        .when(FinalTask, 'step3') // Maps on workflow id
    }

    async step1({ property1, listIds }: TestCommand, _: any) {
      const [firstList, ...remainingListIds] = listIds!
      await this.bus.send(new RunTask(property1!, firstList))

      // Batch send 10 commands (10 list of IDs in state)
      Promise.all([
        listIds!.map(async listId => {
          await this.bus.send(new RunTask(property1!, listId))
        })
      ])

      return { property1, listIds: remainingListIds }
    }

    async step2({ value }: TaskRan, state: HandlerTestWorkflowState) {
      TestWorkflow.step2Counter++

      if (state.listIds.length > 0) {
        const [nextList, ...remainingListIds] = state.listIds
        await this.bus.send(new RunTask(value, nextList))
        return { property1: value, listIds: remainingListIds }
      } else {
        return this.bus.send(new FinalTask())
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
    static retryCount = 0

    constructor(private bus: BusInstance) {}

    async handle(message: RunTask) {
      console.log(message.listId)

      if (RunTaskHandler.retryCount < 3) {
        RunTaskHandler.retryCount++
        throw new Error('Test error')
      }

      await this.bus.send(new TaskRan(message.value, message.listId))
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

    // List of IDs to simulate a batch of commands sent by the first handler
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const correlationId = uuid.v4()

    await bus.send(new TestCommand(uuid.v4(), ids), { correlationId })
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when multiple messages are concurrently handled', () => {
    it('should not spawn more messages', () => {
      completeCallback.verify(
        c =>
          c(
            It.is(workflowId => !!workflowId),
            It.isAny()
          ),
        Times.exactly(1) // Workflow should only be called once
      )

      expect(TestWorkflow.step2Counter).toEqual(10)
    })
  })
})
