import { Command, Event } from '@node-ts/bus-messages'

/**
 * Lend a book to a library member
 */
export class LendBook extends Command {
  // Unique among all of your messages. Routing uses it, so don't change it once deployed.
  static NAME = 'create-bus-app-template/lend-book'
  $name = LendBook.NAME
  $version = 0

  constructor(
    readonly loanId: string,
    readonly bookId: string,
    readonly memberId: string
  ) {
    super()
  }
}

/**
 * A book was lent to a member, and is due back at `dueAt`
 */
export class BookLent extends Event {
  static NAME = 'create-bus-app-template/book-lent'
  $name = BookLent.NAME
  $version = 0

  constructor(
    readonly loanId: string,
    readonly bookId: string,
    readonly memberId: string,
    // Restored as a Date when it's received, by the generated message types
    readonly dueAt: Date
  ) {
    super()
  }
}

/**
 * A member brought a book back
 */
export class BookReturned extends Event {
  static NAME = 'create-bus-app-template/book-returned'
  $name = BookReturned.NAME
  $version = 0

  constructor(
    readonly loanId: string,
    readonly returnedAt: Date
  ) {
    super()
  }
}

/**
 * A loan is over, since its book was returned
 */
export class LoanClosed extends Event {
  static NAME = 'create-bus-app-template/loan-closed'
  $name = LoanClosed.NAME
  $version = 0

  constructor(
    readonly loanId: string,
    readonly returnedLate: boolean
  ) {
    super()
  }
}
