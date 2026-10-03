import { MessageFailure } from './message-failure'

/**
 * The name of the header a transport writes a dead-lettered message's `MessageFailure` under, as one JSON value.
 * One value keeps within the attribute count and size limits of transports such as SQS. Transports reserve it, so
 * outgoing middleware can't set it.
 */
export const FAILURE_HEADER = 'bus-failure'

/**
 * Serializes failure metadata as the value of the `bus-failure` header
 * @param failure the failure metadata the bus passed to `Transport.fail()`
 * @returns the header value, as JSON
 */
export const toFailureHeader = (failure: MessageFailure): string =>
  JSON.stringify(failure)

/**
 * Reads the failure metadata from the value of a dead-lettered message's `bus-failure` header
 * @param header the value of the header, if the message has one
 * @returns the failure metadata, or `undefined` if there's no header or it isn't failure metadata
 * @example
 * const failure = fromFailureHeader(deadLetter.properties.headers?.[FAILURE_HEADER])
 * console.log(`${failure?.error.name} after ${failure?.failedAttempts} attempts on ${failure?.endpoint}`)
 */
export const fromFailureHeader = (
  header: unknown
): MessageFailure | undefined => {
  if (typeof header !== 'string') {
    return undefined
  }
  try {
    const failure = JSON.parse(header) as Partial<MessageFailure> | null
    return typeof failure === 'object' &&
      failure !== null &&
      typeof failure.error === 'object' &&
      typeof failure.failedAttempts === 'number'
      ? (failure as MessageFailure)
      : undefined
  } catch {
    return undefined
  }
}
