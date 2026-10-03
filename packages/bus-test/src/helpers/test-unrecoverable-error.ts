/**
 * An error that retrying can't fix, which the transport tests' recoverability policy dead-letters on its first
 * failure
 */
export class TestUnrecoverableError extends Error {
  constructor(readonly id: string) {
    super(`Message ${id} can never be handled`)
    this.name = 'TestUnrecoverableError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
