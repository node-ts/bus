import { TransportHeaders } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'

/**
 * A message as `RedisTransport` reads it from its queue's stream: the raw message of a `TransportMessage`
 */
export interface RedisTransportMessage {
  /**
   * The stream entry's id. A returned message is added to the stream again, so it gets a new one each retry.
   * @example 1717171717171-0
   */
  id: string

  /**
   * The message, as the bus' serializer wrote it
   */
  body: string

  /**
   * The attributes it was sent with
   */
  attributes: MessageAttributes

  /**
   * The native headers set by outgoing middleware
   */
  headers: TransportHeaders

  /**
   * How many times handling it failed before it was added to the stream again, from its `failedAttempts` field
   */
  failedAttemptsBefore: number

  /**
   * How many times this stream entry has been delivered, including this time. With the consumer that received it,
   * it identifies this receipt: the message is only deleted, returned or dead-lettered while it's still pending to
   * that consumer with this count, so a receipt that another receiver has taken over settles nothing.
   */
  deliveries: number
}
