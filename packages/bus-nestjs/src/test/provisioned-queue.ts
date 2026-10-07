import {
  InMemoryQueue,
  ProvisioningPlan,
  TransportInitializationOptions,
  TransportProvisionOptions
} from '@node-ts/bus-core'

/**
 * An in-memory queue that plans a topic for each message, and records what the bus does with it
 */
export class ProvisionedQueue extends InMemoryQueue {
  /**
   * @param calls where to record the calls, so a test can see them in order with what else it records
   * @param failToInitializeWith an error to throw from `initialize()`
   */
  constructor(
    readonly calls: string[] = [],
    private readonly failToInitializeWith?: Error
  ) {
    super()
  }

  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    this.calls.push('provision')
    return {
      adapter: 'ProvisionedQueue',
      resources: options.messageNames.map(name => ({ type: 'topic', name }))
    }
  }

  async initialize(options?: TransportInitializationOptions): Promise<void> {
    if (this.failToInitializeWith) {
      throw this.failToInitializeWith
    }
    await super.initialize(options)
  }

  async start(): Promise<void> {
    this.calls.push('start')
  }

  async stop(): Promise<void> {
    this.calls.push('stop')
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
    await super.dispose()
  }
}
