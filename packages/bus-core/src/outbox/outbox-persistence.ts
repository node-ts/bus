import {
  isOutgoingMessageStore,
  OutgoingMessageStore
} from '../outgoing-message/outgoing-message-dispatcher'
import { Persistence } from '../workflow/persistence'

/**
 * A persistence that can be used with `withOutbox()`: it runs transactions and stores outgoing messages
 */
export type OutboxPersistence = Persistence &
  OutgoingMessageStore &
  Required<Pick<Persistence, 'beginTransaction'>>

/**
 * Whether a persistence can be used with `withOutbox()`
 */
export const isOutboxPersistence = (
  persistence: Persistence
): persistence is OutboxPersistence =>
  isOutgoingMessageStore(persistence) &&
  typeof persistence.beginTransaction === 'function'
