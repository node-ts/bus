import { TransportHeaders } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'

/**
 * A message as `PostgresTransport` reads it from the `transport_messages` table: the raw message of a
 * `TransportMessage`
 */
export interface PostgresTransportMessage {
  /**
   * The row's id
   */
  id: string

  /**
   * The queue it was sent to
   */
  queue: string

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
   * How many times it's been received, including this time
   */
  deliveries: number

  /**
   * Identifies this receipt of the message. The message is only deleted, returned or dead-lettered while it still
   * has it, so a receipt whose visibility timeout ended, and that another receiver has taken over, settles nothing.
   */
  leaseToken: string
}
