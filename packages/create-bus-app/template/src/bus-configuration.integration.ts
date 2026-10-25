import { BusInstance, handlerFor } from '@node-ts/bus-core'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { createBusConfiguration, QUEUE_NAME } from './bus-configuration.js'
import { BookLent, BookReturned, LendBook, LoanClosed } from './messages.js'

/**
 * Resolves with the first message a test handler receives that matches
 */
const waitFor = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

// Runs the app's bus against the services in compose.yaml (`docker compose up -d --wait`)
describe('createBusConfiguration', { timeout: 60_000 }, () => {
  const loanId = randomUUID()
  const lent = waitFor<BookLent>()
  const closed = waitFor<LoanClosed>()
  let bus: BusInstance

  before(async () => {
    bus = createBusConfiguration({
      // A queue of its own, so a running app doesn't take the test's messages
      queueName: `${QUEUE_NAME}-integration-test`
    })
      .withHandler(
        handlerFor(BookLent, event => {
          if (event.loanId === loanId) lent.resolve(event)
        })
      )
      .withHandler(
        handlerFor(LoanClosed, event => {
          if (event.loanId === loanId) closed.resolve(event)
        })
      )
      // Creates the queues and tables the bus needs when it initializes
      .withAutoProvision()
      .build()
    await bus.initialize()
    await bus.start()
  })

  after(async () => {
    await bus?.dispose()
  })

  describe('when a book is lent and returned', () => {
    it('should lend the book until a later date', async () => {
      await bus.send(new LendBook(loanId, 'book-1', 'member-1'))
      const event = await lent.promise
      assert.ok(event.dueAt instanceof Date)
      assert.ok(event.dueAt.getTime() > Date.now())
    })

    it('should close the loan', async () => {
      await bus.publish(new BookReturned(loanId, new Date()))
      const event = await closed.promise
      assert.equal(event.returnedLate, false)
    })
  })
})
