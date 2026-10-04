import { Message } from '@node-ts/bus-messages'
import { SendOptions } from '../outgoing-message'

/**
 * A message that a handler sent, published or replied with through a fake context from `handlerContext()`,
 * `workflowContext()` or `testWorkflow()`, with the options it passed
 * @example
 * const ctx = handlerContext()
 * await chargeCardHandler.messageHandler(new ChargeCard('1'), messageAttributes(), ctx)
 * deepStrictEqual(ctx.sent, [{ message: new CardCharged('1'), options: { deliverAfter: 30_000 } }])
 */
export interface RecordedMessage<TMessage extends Message = Message> {
  /**
   * The command or event the handler sent, published or replied with
   */
  readonly message: TMessage

  /**
   * The attributes and delivery options it was sent with, such as `deliverAfter` or `deliverAt`, or `{}` when none
   * were given
   */
  readonly options: SendOptions
}
