// A module that exports a bus configuration for `bus provision`, written in TypeScript that Node runs by stripping
// its types
import {
  Bus,
  InMemoryQueue,
  type ProvisioningPlan,
  type TransportProvisionOptions
} from '@node-ts/bus-core'

/**
 * An in-memory queue that plans a topic for each message, without creating anything
 */
class ProvisionedQueue extends InMemoryQueue {
  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    return {
      adapter: 'ProvisionedQueue',
      resources: options.messageNames.map(name => ({ type: 'topic', name })),
      runtimePermissions: { format: 'list', document: ['publish'] }
    }
  }
}

const configure = () =>
  Bus.configure()
    .withTransport(new ProvisionedQueue())
    .withMessageTypes({
      messages: { 'fixture/order-placed': 'order-placed' },
      types: { 'order-placed': { fields: {} } }
    })

export default configure()

export const createBusConfiguration = async () => configure()

export const notABus = 42
