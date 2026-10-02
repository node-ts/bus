import { MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { Bus, BusInstance } from '../service-bus'
import { testMessageTypes } from '../test'
import { defineWorkflow } from './define-workflow'
import { InMemoryPersistence } from './persistence'
import {
  FinalTask,
  RunTask,
  TaskRan,
  TestCommand,
  TestWorkflowState
} from './test'
import { WorkflowContext } from './workflow-context'

jest.setTimeout(10_000)

describe('defineWorkflow', () => {
  describe('when many workflow instances run at once', () => {
    const completeCallback =
      Mock.ofType<(workflowId: string, correlationId: string) => void>()
    const workflowsToInvoke = 100
    const correlationIds = Array.from({ length: workflowsToInvoke }, () =>
      randomUUID()
    )
    let bus: BusInstance

    // The workflow and handler reach the callback through a closure and the bus through their context
    const workflow = defineWorkflow(TestWorkflowState)
      .startedBy(TestCommand, async ({ property1 }, _state, ctx) => {
        await ctx.send(new RunTask(property1!))
        return { property1 }
      })
      .when(
        TaskRan,
        { lookup: message => message.value, mapsTo: 'property1' },
        async (_message, _state, ctx) => {
          await ctx.send(new FinalTask())
        }
      )
      .when(
        FinalTask,
        (
          _message,
          _state,
          ctx: WorkflowContext<
            TestWorkflowState,
            MessageAttributes<{}, { workflowId: string }>
          >
        ) => {
          completeCallback.object(
            ctx.attributes.stickyAttributes.workflowId,
            ctx.correlationId!
          )
          return ctx.complete()
        }
      )
    const runTaskHandler = handlerFor(RunTask, async (message, _, ctx) =>
      ctx.publish(new TaskRan(message.value))
    )

    beforeAll(async () => {
      let completed = 0
      const allCompleted = new Promise<void>(resolve =>
        completeCallback
          .setup(c => c(It.isAny(), It.isAny()))
          .callback(() => {
            if (++completed === workflowsToInvoke) {
              resolve()
            }
          })
      )

      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withPersistence(new InMemoryPersistence())
        .withWorkflow(workflow)
        .withHandler(runTaskHandler)
        .withConcurrency(10)
        .build()
      await bus.initialize()
      await bus.start()

      // Introduce sufficient parallelism to test for message handling context leakage
      await Promise.all(
        correlationIds.map(async correlationId =>
          bus.send(new TestCommand(randomUUID()), { correlationId })
        )
      )
      await allCompleted
    })

    afterAll(async () => bus.dispose())

    it('should complete each workflow once with its own correlation id', () => {
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
