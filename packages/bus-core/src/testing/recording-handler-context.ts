import { Command, Event, Message } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { RecordedMessage } from './recorded-message'
import { Writable } from './writable'

/**
 * A fake `HandlerContext` for unit tests, made by `handlerContext()`. It records what the handler does instead of
 * doing it, so a test asserts on plain arrays and flags with any test runner, without a bus or a mocking framework.
 */
export interface RecordingHandlerContext extends HandlerContext {
  /**
   * The commands sent with `send`, in order, with their options
   */
  readonly sent: RecordedMessage<Command>[]

  /**
   * The events published with `publish`, in order, with their options
   */
  readonly published: RecordedMessage<Event>[]

  /**
   * The messages replied with `reply`, in order, with their attributes
   */
  readonly replied: RecordedMessage<Message>[]

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
 * sent anywhere. The `correlationId` is `undefined` unless it's overridden.
 * @param overrides the members to replace, such as the `correlationId` of the message being handled. Replacing a
 * function stops it from being recorded.
 * @returns a recording handler context
 * @example
 * const ctx = handlerContext()
 * await reserveRoomHandler.messageHandler(new ReserveRoom('room-1'), messageAttributes(), ctx)
 * deepStrictEqual(ctx.published, [{ message: new RoomReserved('room-1'), options: {} }])
 * @example
 * // A class handler
 * await new ReserveRoomHandler(fakeRooms).handle(new ReserveRoom('room-1'), messageAttributes(), ctx)
 */
export const handlerContext = (
  overrides: Partial<HandlerContext> = {}
): RecordingHandlerContext => {
  const context: Writable<RecordingHandlerContext> = {
    correlationId: undefined,
    sent: [],
    published: [],
    replied: [],
    messageFailed: false,
    messageReturned: false,
    send: async (command, options = {}) => {
      context.sent.push({ message: command, options })
    },
    publish: async (event, options = {}) => {
      context.published.push({ message: event, options })
    },
    reply: async (message, messageAttributes = {}) => {
      context.replied.push({ message, options: messageAttributes })
    },
    failMessage: async () => {
      context.messageFailed = true
    },
    returnMessage: async () => {
      context.messageReturned = true
    },
    ...overrides
  }
  return context
}
