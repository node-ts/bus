import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowState } from '../workflow'
import { ScheduledMessage } from './scheduled-message'
import { WorkflowScenarioResult } from './workflow-scenario-result'

/**
 * Runs a workflow in a test, made by `testWorkflow()`. It follows one workflow instance from message to message:
 * it calls the workflow's handlers, saves the state they return the way the bus does, records what they send, and
 * delivers the timeouts they schedule when its clock is moved on. There's no bus, transport or persistence.
 */
export interface WorkflowScenario<TWorkflowState extends WorkflowState> {
  /**
   * The state of the scenario's workflow instance, as last saved, or `undefined` until one is started or given
   */
  readonly state: Readonly<TWorkflowState> | undefined

  /**
   * The time on the scenario's clock
   */
  readonly now: Date

  /**
   * The messages sent or published with `deliverAfter` or `deliverAt` that aren't due yet, in the order they're due
   */
  readonly scheduled: ReadonlyArray<ScheduledMessage>

  /**
   * Sets the state of the workflow instance that the next messages are delivered to, as if it had been started and
   * saved earlier
   * @param workflowState the state. `$workflowId` defaults to a new id, `$status` to running and `$version` to 1.
   * @returns the scenario
   * @example
   * const result = await testWorkflow(orderWorkflow).given({ orderId: '1' }).when(new CardCharged('1'))
   */
  given(
    workflowState: Partial<TWorkflowState>
  ): WorkflowScenario<TWorkflowState>

  /**
   * Delivers a message to the workflow, as the bus would.
   *
   * A message the workflow is started by starts a new instance, which the scenario follows from then on. A message
   * it handles with `when` goes to the scenario's instance if it's running and the message maps to it. With a custom
   * mapping, its `lookup` must return the instance's `mapsTo` field. With the default mapping, the message must
   * carry the instance's `workflowId` sticky attribute, which it's given unless `attributes` set one, as messages
   * sent from the workflow, and replies to them, carry it. Otherwise it isn't handled, as on a bus.
   *
   * The handler's state is saved by the bus' rules: the changes it returns are merged over the state, `$workflowId`,
   * `$version` and `$name` are kept, `complete()` ends the workflow and `discard()` saves nothing. A handler that
   * calls `failMessage()` or `returnMessage()` saves nothing and sends nothing.
   * @param message the message to deliver
   * @param attributes the attributes it arrived with. `attributes` and `stickyAttributes` default to `{}`.
   * @returns what the handler did, and the state after it
   * @throws MessageNotHandledByWorkflow if the workflow isn't started by and doesn't handle the message
   * @throws the error the handler throws, after which nothing is saved, as on a bus that retries the message
   * @example
   * const scenario = testWorkflow(orderWorkflow)
   * const started = await scenario.when(OrderPlaced({ orderId: '1' }))
   * deepStrictEqual(started.sent.map(s => s.message), [new ChargeCard('1')])
   */
  when(
    message: Message,
    attributes?: Partial<MessageAttributes>
  ): Promise<WorkflowScenarioResult<TWorkflowState>>

  /**
   * Moves the scenario's clock on, and delivers each scheduled message that falls due, in the order they're due,
   * with `when()`'s rules. Only messages the workflow handles are delivered. They carry the `workflowId` of the
   * instance that sent them, and the attributes they were sent with. Messages scheduled by the handlers that run,
   * and due in the same time, are delivered too.
   * @param milliseconds how far to move the clock on
   * @returns what happened for each message that was delivered, in order
   * @throws InvalidTimeAdvance if `milliseconds` isn't a finite number of 0 or more
   * @example
   * await scenario.when(OrderPlaced({ orderId: '1' }))
   * const [timedOut] = await scenario.advanceTime(30_000)
   * strictEqual(timedOut.status, WorkflowStatus.Complete)
   */
  advanceTime(
    milliseconds: number
  ): Promise<WorkflowScenarioResult<TWorkflowState>[]>
}
