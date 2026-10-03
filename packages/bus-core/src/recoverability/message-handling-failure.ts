import { Message, MessageAttributes } from '@node-ts/bus-messages'

/**
 * A failed attempt at handling a message, which a `RecoverabilityPolicy` decides what to do with
 */
export interface MessageHandlingFailure {
  /**
   * Why handling failed. When handlers threw, it's a `HandlerDispatchRejected` with each handler's error in
   * `rejections`; use `causedBy()` to look for a type of error anywhere in it. When `returnMessage()` was called
   * without anything throwing, it's a `ReturnMessageRequested`.
   */
  readonly error: unknown

  /**
   * The message that failed
   */
  readonly message: Message

  /**
   * The attributes the message was sent with
   */
  readonly attributes: MessageAttributes

  /**
   * How many times handling the message has failed, counting this failure, so it's `1` the first time it fails
   */
  readonly failedAttempts: number
}
