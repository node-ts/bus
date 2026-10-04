import { Command, Event, Message } from '@node-ts/bus-messages'
import { WorkflowState, WorkflowStatus } from '../workflow'
import { RecordedMessage } from './recorded-message'

/**
 * What happened when a `testWorkflow()` scenario delivered a message to the workflow
 */
export interface WorkflowScenarioResult<TWorkflowState extends WorkflowState> {
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
   * The commands the handler sent, with their options. Those sent with `deliverAfter` or `deliverAt` are also
   * scheduled, and `advanceTime()` delivers the ones the workflow handles. Empty when the handler failed or returned
   * the message, since the bus drops them.
   */
  readonly sent: RecordedMessage<Command>[]

  /**
   * The events the handler published, with their options. Empty when the handler failed or returned the message.
   */
  readonly published: RecordedMessage<Event>[]

  /**
   * The messages the handler replied with, with their attributes. Empty when the handler failed or returned the
   * message.
   */
  readonly replied: RecordedMessage<Message>[]

  /**
   * Whether the handler called `failMessage()`. The bus would dead-letter the message, so the state isn't saved.
   */
  readonly messageFailed: boolean

  /**
   * Whether the handler called `returnMessage()`. The bus would retry the message, so the state isn't saved.
   */
  readonly messageReturned: boolean
}
