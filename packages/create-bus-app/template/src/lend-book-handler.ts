import { handlerFor } from '@node-ts/bus-core'
import { BookLent, LendBook } from './messages.js'

export const LOAN_PERIOD_MS = 14 * 24 * 60 * 60 * 1_000

/**
 * Lends a book. The event is only published once the handler succeeds, since
 * the bus holds what a handler sends until it's done.
 */
export const lendBookHandler = handlerFor(
  LendBook,
  async ({ loanId, bookId, memberId }, _attributes, ctx) => {
    const dueAt = new Date(Date.now() + LOAN_PERIOD_MS)
    await ctx.publish(new BookLent(loanId, bookId, memberId, dueAt))
  }
)
