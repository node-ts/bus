import { handlerContext } from '@node-ts/bus-core'
import { messageAttributes } from '@node-ts/bus-messages'
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { LOAN_PERIOD_MS, lendBookHandler } from './lend-book-handler.js'
import { BookLent, LendBook } from './messages.js'

describe('lendBookHandler', () => {
  describe('when a book is lent', () => {
    // A fake context that records what the handler sends and publishes
    const ctx = handlerContext()
    const lentAt = Date.now()

    before(async () => {
      await lendBookHandler.messageHandler(
        new LendBook('loan-1', 'book-1', 'member-1'),
        messageAttributes(),
        ctx
      )
    })

    it('should publish that the book was lent until the end of the loan period', () => {
      const [{ message }] = ctx.publishedOf(BookLent)
      assert.equal(message.loanId, 'loan-1')
      assert.equal(message.bookId, 'book-1')
      assert.equal(message.memberId, 'member-1')
      assert.ok(message.dueAt.getTime() >= lentAt + LOAN_PERIOD_MS)
    })
  })
})
