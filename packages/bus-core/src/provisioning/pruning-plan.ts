import { ProvisionedResource } from './provisioning-plan'

/**
 * What one transport found on the broker that its bus' configuration no longer needs, such as a subscription or
 * binding of the service queue to the topic or exchange of a message it stopped handling, and whether it removed it.
 * `bus.prune()` returns one for each transport that prunes.
 */
export interface PruningPlan {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Each subscription or binding of the bus' own queue that its configuration no longer needs. It's empty when
   * there's nothing to prune.
   */
  resources: ProvisionedResource[]

  /**
   * Whether `resources` were removed, which they are only when pruned with `apply`
   */
  removed: boolean
}

/**
 * How `bus.prune()` runs
 */
export interface PruneOptions {
  /**
   * Removes what's found. Without it, `prune()` only reports what it would remove.
   * @default false
   */
  apply?: boolean

  /**
   * Prunes a bus that handles no message through a topic or exchange, which removes every subscription or binding of
   * its queue. Without it, such a bus is refused, since it's more often a configuration whose handlers weren't
   * registered than a service that stopped handling everything.
   * @default false
   */
  allowEmpty?: boolean
}
