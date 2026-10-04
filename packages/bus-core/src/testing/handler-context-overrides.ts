import { HandlerContext } from '../handler'

/**
 * The members of a fake `HandlerContext` from `handlerContext()` to replace, and the return address of the message
 * being handled
 */
export interface HandlerContextOverrides extends Partial<HandlerContext> {
  /**
   * The return address (`replyTo` attribute) of the message being handled, which replies are recorded as sent to.
   * Pass `undefined` to test a message without one, so that `reply()` throws `ReturnAddressMissing`, as on a bus.
   * @default TEST_RETURN_ADDRESS
   */
  readonly replyTo?: string
}
