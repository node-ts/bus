export class HandlerAlreadyRegistered extends Error {
  readonly help: string

  constructor (
    readonly handlerName: string
  ) {
    super(`Attempted to register a handler, when a handler with the same name has already been registered.`)
    this.help = `Handlers must be registered with a unique $name property`

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
