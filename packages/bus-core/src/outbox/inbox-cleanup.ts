/**
 * How often a started bus configured with `withOutbox()`, or a scheduler, removes inbox records older than
 * `INBOX_RETENTION_MS`
 */
export const INBOX_CLEANUP_INTERVAL_MS = 60 * 60_000

/**
 * Up to this long is added at random to each wait between cleanups, including the first after the bus starts, so
 * the instances of a service started together don't clean up at once
 */
export const INBOX_CLEANUP_JITTER_MS = 5 * 60_000

/**
 * The most inbox records one call of `Persistence.removeIncomingMessagesBefore` removes, so each statement is short
 * and a cleanup can stop between them when the bus stops
 */
export const INBOX_CLEANUP_BATCH_SIZE = 1_000
