import {
  InMemoryQueue,
  ProvisioningPlan,
  TransportProvisionOptions
} from '@node-ts/bus-core'

/**
 * An in-memory queue that plans a topic for each message, and records what the bus does with it
 */
export class ProvisionedQueue extends InMemoryQueue {
  readonly calls: string[] = []

  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    this.calls.push('provision')
    return {
      adapter: 'ProvisionedQueue',
      resources: options.messageNames.map(name => ({ type: 'topic', name }))
    }
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
