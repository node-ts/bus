// A module that exports a bus configuration for `bus prune`, written in TypeScript that Node runs by stripping its
// types
import {
  Bus,
  handlerFor,
  InMemoryQueue,
  type PruningPlan,
  type TransportPruneOptions
} from '@node-ts/bus-core'
import { defineEvent } from '@node-ts/bus-messages'

const OrderPlaced = defineEvent('fixture/order-placed')()

/**
 * An in-memory queue that finds the subscription of a message the bus no longer handles, without removing anything
 */
class PrunedQueue extends InMemoryQueue {
  async prune(options: TransportPruneOptions): Promise<PruningPlan> {
    return {
      adapter: 'PrunedQueue',
      resources: [{ type: 'subscription', name: 'fixture/order-cancelled' }],
      removed: options.apply
    }
  }
}

const configure = () =>
  Bus.configure()
    .withTransport(new PrunedQueue())
    .withMessageTypes({
      messages: { 'fixture/order-placed': 'order-placed' },
      types: { 'order-placed': { fields: {} } }
    })
    .withHandler(handlerFor(OrderPlaced, () => undefined))

export default configure()

export const sendOnlyBus = () => configure().asSendOnly()
