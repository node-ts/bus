import { ProvisionReportResource } from '../provision'

/**
 * The JSON `bus prune --json` prints. Fields are only added to it, never renamed or removed, unless `formatVersion`
 * changes.
 */
export interface PruneReport {
  /**
   * The version of this format
   */
  formatVersion: 1

  /**
   * Whether it was run with `--apply`, so what was found and printed was removed
   */
  applied: boolean

  /**
   * What each transport of the bus that prunes found
   */
  adapters: PruneReportAdapter[]
}

/**
 * What one transport found that the bus no longer needs, and what it removed
 */
export interface PruneReportAdapter {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Each subscription or binding of the bus' own queue that its configuration no longer needs, such as an
   * `sns-subscription` or a `rabbitmq-binding`. With `--apply`, just those printed before removing them that are
   * still found.
   */
  resources: ProvisionReportResource[]

  /**
   * Each of `resources` that was removed. It's empty without `--apply`.
   */
  removed: ProvisionReportResource[]

  /**
   * Each of `resources` that couldn't be removed, with the error's message. It's empty without `--apply`, and the
   * command exits with `1` when it isn't.
   */
  failed: PruneReportFailure[]

  /**
   * With `--apply`, each resource printed before removing it that was no longer found when it was to be removed, so
   * was left as it is
   */
  notFound: ProvisionReportResource[]
}

/**
 * A subscription or binding that couldn't be removed
 */
export interface PruneReportFailure {
  /**
   * What couldn't be removed
   */
  resource: ProvisionReportResource

  /**
   * The message of the error removing it failed with
   */
  error: string
}
