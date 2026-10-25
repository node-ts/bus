import { defineWorkflow } from '@node-ts/bus-core'
import { LoanState } from './loan-state.js'
import { BookLent, BookReturned, LoanClosed } from './messages.js'

/**
 * Follows a loan from when its book is lent until it comes back
 */
export const loanWorkflow = defineWorkflow(LoanState)
  // Each BookLent starts a new loan
  .startedBy(BookLent, ({ loanId, bookId, memberId, dueAt }) => ({
    loanId,
    bookId,
    memberId,
    dueAt,
    status: 'on-loan' as const
  }))
  // Finds the loan whose loanId is the event's
  .when(
    BookReturned,
    { lookup: event => event.loanId, mapsTo: 'loanId' },
    async ({ returnedAt }, state, ctx) => {
      const returnedLate = returnedAt.getTime() > state.dueAt.getTime()
      await ctx.publish(new LoanClosed(state.loanId, returnedLate))
      return ctx.complete({ status: 'returned', returnedAt })
    }
  )
