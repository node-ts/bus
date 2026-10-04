import { MessageAttributes } from '@node-ts/bus-messages'
import { TransportHeaders } from '../transport'

/**
 * A message the bus has stored in its persistence to send later, such as one sent with `deliverAfter` or
 * `deliverAt`, or one stored in the transactional outbox. It holds the message as the outgoing middleware left it,
 * so the bus sends it to the transport as it is, without running the middleware again.
 *
 * Its `message`, `attributes` and `headers` are plain JSON values, which a persistence stores as they are and
 * returns unchanged, as it does `destination`.
 */
export interface OutgoingMessage {
  /**
   * Identifies the stored message. It's the message's `messageId`, so each message stored must have its own.
   */
  id: string

  /**
   * Whether the message is sent as a command, published as an event, or sent as a reply to `destination`. Only the
   * transactional outbox stores replies, since they can't be delayed.
   */
  kind: 'send' | 'publish' | 'reply'

  /**
   * For a reply, the address it's sent to: the return address of the message it replies to. Other messages have
   * none.
   */
  destination?: string

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
   * When storing, holds the message as already claimed for this many milliseconds from when it's stored, by the
   * store's own clock, so that only the process that stored it sends it before then, such as straight after it
   * commits. It's claimed by anyone after that if it hasn't been deleted, or before that if it's released. Stores
   * don't return it.
   */
  leaseMs?: number

  /**
   * Set by `claimDueOutgoingMessages`: how many times the message has been claimed, including this claim
   */
  attempts?: number
}
