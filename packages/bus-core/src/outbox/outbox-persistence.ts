import {
  isOutgoingMessageStore,
  OutgoingMessageStore
} from '../outgoing-message/outgoing-message-dispatcher'
import { Persistence } from '../workflow/persistence'

/**
 * A persistence that can be used with `withOutbox()`: it runs transactions, stores outgoing messages, and removes
 * old inbox records
 */
export type OutboxPersistence = Persistence &
  OutgoingMessageStore &
  Required<
    Pick<Persistence, 'beginTransaction' | 'removeIncomingMessagesBefore'>
  >

/**
 * Whether a persistence can be used with `withOutbox()`
 */
export const isOutboxPersistence = (
  persistence: Persistence
): persistence is OutboxPersistence =>
  isOutgoingMessageStore(persistence) &&
  typeof persistence.beginTransaction === 'function' &&
  typeof persistence.removeIncomingMessagesBefore === 'function'
