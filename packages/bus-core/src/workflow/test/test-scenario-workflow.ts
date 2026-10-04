import {
  defineCommand,
  defineEvent,
  MessageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { HandlerContext } from '../../handler'
import { defineWorkflow } from '../define-workflow'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'

/**
 * What a scenario workflow's timeout handler does: throw, fail the message and then throw, return the message, or
 * complete the workflow
 */
export type TestScenarioTimeoutOutcome =
  'throw' | 'failThenThrow' | 'return' | 'complete'

/**
 * Starts a scenario workflow, which replies to it and schedules a timeout that does what `timeoutOutcome` says
 */
export const StartTestScenario = defineCommand(
  '@node-ts/bus-core/start-test-scenario'
)<{ orderNumber: number; timeoutOutcome: TestScenarioTimeoutOutcome }>()
export type StartTestScenario = MessageOf<typeof StartTestScenario>

/**
 * The reply to `StartTestScenario`
 */
export const TestScenarioStarted = defineEvent(
  '@node-ts/bus-core/test-scenario-started'
)<{ orderNumber: number }>()
export type TestScenarioStarted = MessageOf<typeof TestScenarioStarted>

/**
 * Found by a custom mapping on a number field, which can be 0
 */
export const TestScenarioItemAdded = defineEvent(
  '@node-ts/bus-core/test-scenario-item-added'
)<{ orderNumber: number }>()
export type TestScenarioItemAdded = MessageOf<typeof TestScenarioItemAdded>

/**
 * The timeout of a scenario workflow
 */
export const TestScenarioTimedOut = defineCommand(
  '@node-ts/bus-core/test-scenario-timed-out'
)<{ outcome: TestScenarioTimeoutOutcome }>()
export type TestScenarioTimedOut = MessageOf<typeof TestScenarioTimedOut>

export class TestScenarioState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-scenario-state'
  $name = TestScenarioState.NAME

  orderNumber: number
  items: number
  /**
   * The attributes the timeout arrived with
   */
  timeoutCorrelationId: string | undefined
  timeoutReplyTo: string | undefined
}

const TIMEOUT_MS = 1_000

/**
 * Replies to its start, schedules a timeout, counts items mapped by a number, and does what the timeout says
 */
export const testScenarioWorkflow = defineWorkflow(TestScenarioState)
  .startedBy(
    StartTestScenario,
    async ({ orderNumber, timeoutOutcome }, _state, ctx) => {
      await ctx.reply(TestScenarioStarted({ orderNumber }))
      await ctx.send(TestScenarioTimedOut({ outcome: timeoutOutcome }), {
        deliverAfter: TIMEOUT_MS
      })
      return {
        orderNumber,
        items: 0,
        timeoutCorrelationId: undefined,
        timeoutReplyTo: undefined
      }
    }
  )
  .when(
    TestScenarioItemAdded,
    // The bus' lookup type says string, but a number field maps the same way at runtime
    { lookup: m => m.orderNumber as unknown as string, mapsTo: 'orderNumber' },
    (_message, state) => ({ items: state.items + 1 })
  )
  .when(TestScenarioTimedOut, async ({ outcome }, _state, ctx) => {
    if (outcome === 'throw') {
      throw new Error('The timeout failed')
    }
    if (outcome === 'failThenThrow') {
      await ctx.failMessage()
      throw new Error('The timeout was failed, then threw')
    }
    if (outcome === 'return') {
      await ctx.returnMessage()
      return
    }
    return ctx.complete({
      timeoutCorrelationId: ctx.attributes.correlationId,
      timeoutReplyTo: ctx.attributes.replyTo
    })
  })

/**
 * A dependency of `TestScenarioClassWorkflow`
 */
export interface TestScenarioNumbering {
  next(): number
}

/**
 * A class workflow with a constructor dependency, which a container would give it
 */
export class TestScenarioClassWorkflow extends Workflow<TestScenarioState> {
  constructor(private readonly numbering: TestScenarioNumbering) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<TestScenarioState, TestScenarioClassWorkflow>
  ): void {
    mapper.withState(TestScenarioState).startedBy(StartTestScenario, 'start')
  }

  async start(
    _message: StartTestScenario,
    _state: TestScenarioState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    const orderNumber = this.numbering.next()
    await ctx.reply(TestScenarioStarted({ orderNumber }))
    return { orderNumber, items: 0 }
  }
}
