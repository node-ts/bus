import { ProvisionedResource } from './provisioning-plan'

/**
 * A subscription or binding that pruning found but couldn't remove, and why
 */
export interface PruneFailure {
  /**
   * What couldn't be removed
   */
  resource: ProvisionedResource

  /**
   * What the broker or its client threw when it was removed
   */
  error: unknown
}

/**
 * What one transport found on the broker that its bus' configuration no longer needs, such as a subscription or
 * binding of the service queue to the topic or exchange of a message it stopped handling, and what it removed.
 * `bus.prune()` returns one for each transport that prunes.
 */
export interface PruningPlan {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Each subscription or binding of the bus' own queue that its configuration no longer needs. When pruned with
   * `only`, just those of them in `only`. It's empty when there's nothing to prune.
   */
  resources: ProvisionedResource[]

  /**
   * Each of `resources` that was removed. It's empty unless pruned with `apply`.
   */
  removed: ProvisionedResource[]

  /**
   * Each of `resources` that couldn't be removed, with the error. It's empty unless pruned with `apply`, and
   * `bus.prune()` throws `PruneIncomplete` when it isn't.
   */
  failed: PruneFailure[]

  /**
   * Each resource in `only` that the transport no longer finds among what the bus doesn't need, such as one removed
   * by someone else since it was listed, so it was left as it is. It's empty unless pruned with `only`.
   */
  notFound: ProvisionedResource[]
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
   * Only these resources may be removed: what an earlier `prune()` without `apply` returned, once someone has
   * approved it. What the transport finds now that isn't in it is left as it is, and what's in it that the transport
   * no longer finds is reported in `notFound`. Without it, everything found is removed.
   */
  only?: ProvisionedResource[]

  /**
   * Prunes a bus that handles no message through a topic or exchange, which removes every subscription or binding of
   * its queue. Without it, such a bus is refused, since it's more often a configuration whose handlers weren't
   * registered than a service that stopped handling everything.
   * @default false
   */
  allowEmpty?: boolean

  /**
   * Prunes a bus with a custom handler that has no `topicIdentifier`. Without it, such a bus is refused, since the
   * handler's messages may arrive through a subscription or binding made outside the bus, which pruning would take
   * for an orphaned one. Set it only when they're sent straight to the queue, such as S3 event notifications or
   * messages another system sends to it, so there's no subscription or binding to keep.
   * @default false
   */
  allowCustomHandlersWithoutTopic?: boolean
}
