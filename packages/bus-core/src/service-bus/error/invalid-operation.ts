export class InvalidOperation extends Error {
  constructor(message: string) {
    super(message)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
