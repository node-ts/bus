import { Message } from '@node-ts/bus-messages'
import { RecordedMessage } from './recorded-message'

/**
 * A message that a workflow handler sent or published with `deliverAfter` or `deliverAt` in a `testWorkflow()`
 * scenario, which the scenario's `advanceTime()` hasn't reached yet
 */
export interface ScheduledMessage<
  TMessage extends Message = Message
> extends RecordedMessage<TMessage> {
  /**
   * When it's due, on the scenario's clock
   */
  readonly dueAt: Date
}
