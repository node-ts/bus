import { createConnection, createServer, Server, Socket } from 'node:net'

/**
 * A TCP proxy in front of Redis that can be frozen: it then stops passing data either way, but keeps every connection
 * open, as a hung server, a stalled network or a half-open socket would. New connections are accepted, and get no
 * answer either.
 */
export class FreezableProxy {
  private readonly server: Server
  private readonly sockets = new Set<Socket>()
  private frozen = false

  /**
   * @param target where Redis listens
   */
  constructor(private readonly target: { host: string; port: number }) {
    this.server = createServer(client => this.connect(client))
  }

  /**
   * The port the proxy listens on, once it's started
   */
  get port(): number {
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('The proxy has not started')
    }
    return address.port
  }

  /**
   * Starts listening on a free port of 127.0.0.1
   */
  async start(): Promise<void> {
    await new Promise<void>(resolve =>
      this.server.listen(0, '127.0.0.1', resolve)
    )
  }

  /**
   * Stops passing data, without closing any connection
   */
  freeze(): void {
    this.frozen = true
  }

  /**
   * Closes every connection and stops listening
   */
  async close(): Promise<void> {
    this.sockets.forEach(socket => socket.destroy())
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private connect(client: Socket): void {
    const upstream = createConnection(this.target)
    for (const [from, to] of [
      [client, upstream],
      [upstream, client]
    ]) {
      this.sockets.add(from)
      from.on('data', data => {
        if (!this.frozen) {
          to.write(data)
        }
      })
      // The other side may already be gone, which the test doesn't care about
      from.on('error', () => undefined)
      from.on('close', () => {
        this.sockets.delete(from)
        to.destroy()
      })
    }
  }
}
