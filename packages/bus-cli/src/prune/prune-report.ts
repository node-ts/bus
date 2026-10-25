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
   * Whether it was run with `--apply`, so what was found was removed
   */
  applied: boolean

  /**
   * What each transport of the bus that prunes found
   */
  adapters: PruneReportAdapter[]
}

/**
 * What one transport found that the bus no longer needs
 */
export interface PruneReportAdapter {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Each subscription or binding of the bus' own queue that its configuration no longer needs, such as an
   * `sns-subscription` or a `rabbitmq-binding`
   */
  resources: ProvisionReportResource[]

  /**
   * Whether `resources` were removed
   */
  removed: boolean
}
