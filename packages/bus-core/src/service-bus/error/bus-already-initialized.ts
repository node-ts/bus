export class BusAlreadyInitialized extends Error {
  readonly help: string

  constructor() {
    super(`Attempted to configure Bus after its been initialized`)
    this.help = `Ensure all configuration operations happen once at startup of your app`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
