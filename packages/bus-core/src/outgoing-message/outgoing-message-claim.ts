/**
 * Identifies one claim of a stored outgoing message, so it can be released without touching a later claim of the
 * same message by another process
 */
export interface OutgoingMessageClaim {
  /**
   * The `id` of the claimed message
   */
  id: string

  /**
   * The message's `attempts` as the claim returned it. A later claim counts another attempt, so it no longer matches.
   */
  attempts: number
}
