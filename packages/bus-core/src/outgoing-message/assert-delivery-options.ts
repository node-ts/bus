import { Message } from '@node-ts/bus-messages'
import { InvalidDeliveryOptions } from './error'
import { SendOptions } from './send-options'

/**
 * Checks the `deliverAfter` and `deliverAt` of a `send()` or `publish()`, the same way for the bus and the fake
 * contexts of the test helpers. Internal: it isn't exported from the package.
 * @param message the message being sent
 * @param options the options it's sent with
 * @returns whether the message is delayed, which is when either option is given
 * @throws InvalidDeliveryOptions if both are given, `deliverAfter` isn't a finite number of 0 or more, or
 * `deliverAt` isn't a valid Date
 */
export const assertDeliveryOptions = (
  message: Message,
  { deliverAfter, deliverAt }: SendOptions
): boolean => {
  if (deliverAfter === undefined && deliverAt === undefined) {
    return false
  }
  if (deliverAfter !== undefined && deliverAt !== undefined) {
    throw new InvalidDeliveryOptions(
      'deliverAfter and deliverAt were both given',
      message.$name
    )
  }
  if (
    deliverAfter !== undefined &&
    (typeof deliverAfter !== 'number' ||
      !Number.isFinite(deliverAfter) ||
      deliverAfter < 0)
  ) {
    throw new InvalidDeliveryOptions(
      `deliverAfter must be a number of milliseconds that's 0 or more, but was ${String(deliverAfter)}`,
      message.$name
    )
  }
  if (
    deliverAt !== undefined &&
    (!(deliverAt instanceof Date) || Number.isNaN(deliverAt.getTime()))
  ) {
    throw new InvalidDeliveryOptions(
      `deliverAt must be a valid Date, but was ${String(deliverAt)}`,
      message.$name
    )
  }
  return true
}
