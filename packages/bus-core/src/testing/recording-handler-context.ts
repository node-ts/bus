import { HandlerContext } from '../handler'
import {
  createRecordingHandlerContext,
  UNNAMED_REQUEST
} from './create-recording-handler-context'
import { HandlerContextOverrides } from './handler-context-overrides'
import { RecordedMessages } from './recorded-messages'

/**
 * A fake `HandlerContext` for unit tests, made by `handlerContext()`. It records what the handler does instead of
 * doing it, so a test asserts on plain arrays and flags with any test runner, without a bus or a mocking framework.
 *
 * It records every call, including one made after the handler resolved, such as from a timer it started. On a bus,
 * a send or publish made then is sent straight away rather than with the handler's other messages, or dropped if the
 * handler failed, and a late `reply()` throws `ReplyOutsideHandlingContext`.
 */
export interface RecordingHandlerContext
  extends HandlerContext, RecordedMessages {
  /**
   * Whether `failMessage` was called. On a bus the message would be dead-lettered, and what the handler sent dropped.
   */
  readonly messageFailed: boolean

  /**
   * Whether `returnMessage` was called. On a bus the message would be retried, and what the handler sent dropped.
   */
  readonly messageReturned: boolean
}

/**
 * Creates a `HandlerContext` to call a handler with in a test. It records what the handler sends, publishes and
 * replies with in `sent`, `published` and `replied`, each with the options it was given, such as `deliverAfter`,
 * and sets `messageFailed` or `messageReturned` when the handler calls `failMessage` or `returnMessage`. Nothing is
 * sent anywhere. `sentOf`, `publishedOf` and `repliedOf` narrow the recorded messages to one type, to read their
 * fields.
 *
 * It checks what the bus checks: `send` and `publish` throw `InvalidDeliveryOptions` for a `deliverAfter` or
 * `deliverAt` the bus would reject, and `reply` throws `DelayedReplyNotSupported` when it's given either, and
 * `ReturnAddressMissing` when the message being handled has no return address. Replies are recorded as sent to
 * `TEST_RETURN_ADDRESS` unless `replyTo` is given. The `correlationId` is `undefined` unless it's overridden.
 * @param overrides the members to replace, such as the `correlationId` of the message being handled, and its
 * `replyTo`. Replacing a function stops it from being recorded.
 * @returns a recording handler context
 * @throws InvalidDeliveryOptions from `send` or `publish`, if `deliverAfter` or `deliverAt` isn't a usable time, or
 * both are given
 * @example
 * const ctx = handlerContext()
 * await reserveRoomHandler.messageHandler(new ReserveRoom('room-1'), messageAttributes(), ctx)
 * deepStrictEqual(ctx.published, [{ message: new RoomReserved('room-1'), options: {} }])
 * strictEqual(ctx.publishedOf(RoomReserved)[0].message.roomId, 'room-1')
 * @example
 * // A class handler
 * await new ReserveRoomHandler(fakeRooms).handle(new ReserveRoom('room-1'), messageAttributes(), ctx)
 */
export const handlerContext = (
  overrides: HandlerContextOverrides = {}
): RecordingHandlerContext =>
  createRecordingHandlerContext(overrides, UNNAMED_REQUEST)
