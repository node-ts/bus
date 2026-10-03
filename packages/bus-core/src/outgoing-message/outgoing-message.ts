import { MessageAttributes } from '@node-ts/bus-messages'
import { TransportHeaders } from '../transport'

/**
 * A message the bus has stored in its persistence to send later, such as one sent with `deliverAfter` or
 * `deliverAt`. It holds the message as the outgoing middleware left it, so the bus sends it to the transport as it
 * is, without running the middleware again.
 *
 * Its `message`, `attributes` and `headers` are plain JSON values, which a persistence stores as they are and
 * returns unchanged.
 */
export interface OutgoingMessage {
  /**
   * Identifies the stored message. It's the message's `messageId`, so each message stored must have its own.
   */
  id: string

  /**
   * Whether the message is sent as a command or published as an event
   */
  kind: 'send' | 'publish'

  /**
   * The command or event, as plain JSON values
   */
  message: object

  /**
   * The attributes the message is sent with, including its correlation id and sticky attributes
   */
  attributes: MessageAttributes

  /**
   * The native transport headers set by outgoing middleware
   */
  headers: TransportHeaders

  /**
   * When the message is due to be sent. It isn't claimed before this time.
   */
  dueAt: Date

  /**
   * When storing, holds the message as already claimed until this time, so that only the process that stored it
   * sends it before then, such as straight after it commits. It's claimed by anyone after this time if it hasn't
   * been deleted. Stores don't return it.
   */
  leaseUntil?: Date

  /**
   * Set by `claimDueOutgoingMessages`: how many times the message has been claimed, including this claim
   */
  attempts?: number
}
