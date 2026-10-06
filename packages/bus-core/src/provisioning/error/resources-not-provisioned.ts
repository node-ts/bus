/**
 * Thrown by `bus.initialize()` when a transport or persistence finds that resources the bus needs, such as a
 * queue, topic or table, don't exist. The bus doesn't create them at runtime unless it's configured with
 * `withAutoProvision()`.
 */
export class ResourcesNotProvisioned extends Error {
  readonly help: string

  /**
   * @param adapterName the class name of the transport or persistence, such as `SqsTransport`
   * @param missingResources a description of each resource that doesn't exist
   */
  constructor(
    readonly adapterName: string,
    readonly missingResources: string[]
  ) {
    super(
      `${adapterName} can't be initialized, because ${missingResources.length === 1 ? "this resource doesn't" : `these ${missingResources.length} resources don't`} exist: ${missingResources.join(', ')}`
    )
    this.help = `Provision them before the service starts by running \`bus provision <module>\` from @node-ts/bus-cli (or calling bus.provision()) with deploy credentials. For local development and tests, configure the bus with withAutoProvision() to create them when it initializes. If they're created by other tooling and the service can't be given permission to describe them, turn this check off with withResourceVerification(false).`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
