import { HandlerDispatchRejected } from '../handler/error'
import { MessageFailure, MessageFailureError } from './message-failure'

const MAX_ERROR_MESSAGE_LENGTH = 1_000
const MAX_ERROR_STACK_LENGTH = 4_000

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value

/**
 * Describes an error for failure metadata. A `HandlerDispatchRejected` with one handler's error is described by that
 * error, whose stack points at the handler rather than the bus.
 */
const describeError = (error: unknown): MessageFailureError => {
  if (
    error instanceof HandlerDispatchRejected &&
    error.rejections.length === 1
  ) {
    return describeError(error.rejections[0])
  }
  if (!(error instanceof Error)) {
    return {
      name: 'NonError',
      message: truncate(String(error), MAX_ERROR_MESSAGE_LENGTH)
    }
  }
  return {
    // The bus' own errors don't set name, so it's always "Error"; the class name says what failed
    name: error.name === 'Error' ? error.constructor.name : error.name,
    message: truncate(error.message, MAX_ERROR_MESSAGE_LENGTH),
    ...(error.stack
      ? { stack: truncate(error.stack, MAX_ERROR_STACK_LENGTH) }
      : {})
  }
}

/**
 * Builds the failure metadata of a message being dead-lettered, with its error truncated to fit in a transport
 * header. The bus calls it before `Transport.fail()`; a transport can call it for a message it dead-letters itself,
 * such as one it can't parse.
 * @param error what the message failed with
 * @param details how many times it failed, the transport's `endpointName` and the message's `messageId`
 * @returns the failure metadata, with `failedAt` set to now
 */
export const createMessageFailure = (
  error: unknown,
  details: Pick<MessageFailure, 'failedAttempts' | 'endpoint' | 'messageId'>
): MessageFailure => ({
  error: describeError(error),
  failedAttempts: details.failedAttempts,
  endpoint: details.endpoint,
  messageId: details.messageId,
  failedAt: new Date().toISOString()
})
