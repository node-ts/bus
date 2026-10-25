import { testWorkflow, WorkflowStatus } from '@node-ts/bus-core'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loanWorkflow } from './loan-workflow.js'
import { BookLent, BookReturned, LoanClosed } from './messages.js'

const dueAt = new Date('2030-01-15T12:00:00Z')

describe('loanWorkflow', () => {
  describe('when a book is lent', () => {
    it('should start a loan', async () => {
      const lent = await testWorkflow(loanWorkflow).when(
        new BookLent('loan-1', 'book-1', 'member-1', dueAt)
      )
      assert.equal(lent.status, WorkflowStatus.Running)
      assert.equal(lent.state?.status, 'on-loan')
      assert.deepEqual(lent.state?.dueAt, dueAt)
    })
  })

  describe('when the book is returned on time', () => {
    it('should close the loan', async () => {
      const scenario = testWorkflow(loanWorkflow)
      await scenario.when(new BookLent('loan-1', 'book-1', 'member-1', dueAt))

      const returned = await scenario.when(
        new BookReturned('loan-1', new Date('2030-01-10T12:00:00Z'))
      )

      assert.equal(returned.status, WorkflowStatus.Complete)
      assert.deepEqual(
        returned.published.map(published => published.message),
        [new LoanClosed('loan-1', false)]
      )
    })
  })

  describe('when the book is returned late', () => {
    it('should close the loan as returned late', async () => {
      const returned = await testWorkflow(loanWorkflow)
        .given({ loanId: 'loan-2', dueAt, status: 'on-loan' })
        .when(new BookReturned('loan-2', new Date('2030-02-01T12:00:00Z')))

      assert.deepEqual(
        returned.publishedOf(LoanClosed).map(published => published.message),
        [new LoanClosed('loan-2', true)]
      )
    })
  })

  describe('when a book is returned for an unknown loan', () => {
    it('should not handle it', async () => {
      const returned = await testWorkflow(loanWorkflow).when(
        new BookReturned('unknown-loan', new Date())
      )
      assert.equal(returned.handled, false)
    })
  })
})
