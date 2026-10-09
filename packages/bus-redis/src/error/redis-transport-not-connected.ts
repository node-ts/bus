/**
 * Thrown when `RedisTransport` is used before it has connected, such as when it sends before the bus that owns it
 * has been initialized
 */
export class RedisTransportNotConnected extends Error {
  readonly help: string

  constructor() {
    super('RedisTransport is not connected to Redis')
    this.help =
      'Initialize the bus that uses the transport (await bus.initialize()) before sending, or provision it with bus.provision(), which connects first'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
