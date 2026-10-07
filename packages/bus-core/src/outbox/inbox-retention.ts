/**
 * How long the inbox of a bus configured with `withOutbox()` keeps the record of a message it handled. A copy of the
 * message delivered within this time is skipped; one delivered later is handled again.
 */
export const INBOX_RETENTION_MS = 7 * 24 * 60 * 60_000
