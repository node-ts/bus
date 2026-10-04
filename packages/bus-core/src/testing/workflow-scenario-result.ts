import { Message } from '@node-ts/bus-messages'
import { WorkflowState, WorkflowStatus } from '../workflow'
import { RecordedMessages } from './recorded-messages'

/**
 * What happened when a `testWorkflow()` scenario delivered a message to the workflow.
 *
 * `sent`, `published` and `replied` hold what the handler sent, published and replied with, and `sentOf`,
 * `publishedOf` and `repliedOf` narrow them to one type. Commands and events sent with `deliverAfter` or `deliverAt`
 * are also scheduled, and `advanceTime()` delivers the ones the workflow handles. All three are empty when the
 * handler failed or returned the message, since the bus drops them.
 */
export interface WorkflowScenarioResult<
  TWorkflowState extends WorkflowState
> extends RecordedMessages {
  /**
   * The message that was delivered
   */
  readonly message: Message

  /**
   * Whether a handler of the workflow ran. It's `false` when the message is handled by `when` but found no running
   * instance, such as a timeout that arrives after the workflow completed, which the bus ignores.
   */
  readonly handled: boolean

  /**
   * Whether the handler returned `discard()` or `discardWorkflow()`, so its changes weren't saved, and a `startedBy`
   * handler didn't start an instance
   */
  readonly discarded: boolean

  /**
   * The state of the scenario's workflow instance after the message, as the bus would have saved it, with
   * `$version` counting its saves. It's `undefined` until an instance is started or given.
   */
  readonly state: Readonly<TWorkflowState> | undefined

  /**
   * The `$status` of `state`: running, or complete once a handler completed the workflow
   */
  readonly status: WorkflowStatus | undefined

  /**
   * Whether the handler called `failMessage()`. The bus would dead-letter the message, so the state isn't saved.
   */
  readonly messageFailed: boolean

  /**
   * Whether the handler called `returnMessage()`. The bus would retry the message, so the state isn't saved, and a
   * scheduled message that `advanceTime()` delivered is scheduled again.
   */
  readonly messageReturned: boolean
}
