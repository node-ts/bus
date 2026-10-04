import { Message, MessageAttributes } from '@node-ts/bus-messages'

/**
 * A message that a handler replied with through a fake context from `handlerContext()`, `workflowContext()` or
 * `testWorkflow()`, with the attributes it passed and where it would have gone
 * @example
 * const ctx = handlerContext()
 * await checkCreditHandler.messageHandler(new CheckCredit('1'), messageAttributes(), ctx)
 * deepStrictEqual(ctx.replied, [
 *   { message: new CreditChecked('1', true), options: {}, destination: TEST_RETURN_ADDRESS }
 * ])
 */
export interface RecordedReply<TMessage extends Message = Message> {
  /**
   * The command or event the handler replied with
   */
  readonly message: TMessage

  /**
   * The attributes it was replied with, or `{}` when none were given
   */
  readonly options: Partial<MessageAttributes>

  /**
   * The return address (`replyTo` attribute) of the message being handled, which the reply is sent to
   */
  readonly destination: string
}
