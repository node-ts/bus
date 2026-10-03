import {
  Bus,
  causedBy,
  deadLetter,
  defaultRecoverability,
  exponentialBackoff,
  FAILURE_HEADER,
  fromFailureHeader,
  handlerFor,
  RecoverabilityPolicy,
  retry
} from '@node-ts/bus-core'
import { messageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual } from 'node:assert'
import { messageTypes } from './message-types.generated'
import { ReserveRoom } from './messages'
import { reservationService } from './services'

// #region default
/**
 * Thrown when a booking breaks a business rule, which no retry can fix
 */
export class InvalidBooking extends Error {}

Bus.configure()
  .withMessageTypes(messageTypes)
  .withRecoverability(
    defaultRecoverability({
      // Handle each message up to 5 times before dead-lettering it
      maxAttempts: 5,
      delay: exponentialBackoff({ initialDelay: 1_000, factor: 2 }),
      unrecoverable: [InvalidBooking]
    })
  )
// #endregion default

// #region custom
/**
 * Thrown when a downstream service rate limits us
 */
export class RateLimited extends Error {}

const reservationsPolicy: RecoverabilityPolicy = ({
  error,
  failedAttempts
}) => {
  if (causedBy(error, [InvalidBooking])) {
    return deadLetter()
  }
  if (causedBy(error, [RateLimited])) {
    // Back off for a minute at a time, and keep trying for longer
    return failedAttempts < 20 ? retry(60_000) : deadLetter()
  }
  return failedAttempts < 5 ? retry(1_000 * failedAttempts) : deadLetter()
}

Bus.configure()
  .withMessageTypes(messageTypes)
  .withRecoverability(reservationsPolicy)
// #endregion custom

// #region testing
// A policy is a plain function, so test it by calling it
deepStrictEqual(
  reservationsPolicy({
    error: new InvalidBooking(),
    message: new ReserveRoom('room-1', 'booking-1'),
    attributes: messageAttributes(),
    failedAttempts: 1
  }),
  deadLetter()
)
// #endregion testing

// #region fail-message
export const reserveRoomOrFail = handlerFor(
  ReserveRoom,
  async (command, _attributes, ctx) => {
    if (!command.bookingId) {
      // Retrying can't fix it, so dead-letter it once the handler returns
      await ctx.failMessage()
      return
    }
    await reservationService.reserveRoom(command.roomId, command.bookingId)
  }
)
// #endregion fail-message

// #region read-failure
/**
 * Logs why a dead-lettered message failed
 * @param headers the message's headers, such as `properties.headers` of a RabbitMQ message
 */
export const logDeadLetter = (headers: Record<string, unknown>): void => {
  const failure = fromFailureHeader(headers[FAILURE_HEADER])
  if (failure) {
    console.log(
      `${failure.error.name}: ${failure.error.message}`,
      `after ${failure.failedAttempts} attempts on ${failure.endpoint}`
    )
  }
}
// #endregion read-failure
