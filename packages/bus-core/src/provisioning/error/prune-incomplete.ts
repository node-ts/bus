import { PruningPlan } from '../pruning-plan'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const count = (plans: PruningPlan[], key: 'resources' | 'removed' | 'failed') =>
  plans.reduce((total, plan) => total + plan[key].length, 0)

/**
 * Thrown by `bus.prune({ apply: true })` when a transport couldn't remove some of what it found, such as when a
 * permission is missing or the broker closed the connection part way. Everything else was still tried, and `plans`
 * says exactly what was removed and what failed.
 */
export class PruneIncomplete extends Error {
  readonly help =
    'What was removed stays removed, and what failed is left as it was. Fix the cause, such as a missing permission, then prune again. To restore what was removed, run `bus provision` with the version that still handles it.'

  /**
   * @param endpointName the name of the bus' queue, from its transport
   * @param plans what each transport found, removed and failed to remove
   */
  constructor(
    readonly endpointName: string,
    readonly plans: PruningPlan[]
  ) {
    const failures = plans.flatMap(({ failed }) => failed)
    super(
      `Pruning the bus of ${endpointName || 'the transport'} removed ${count(plans, 'removed')} of ${count(plans, 'resources')} resources, and ${failures.length} couldn't be removed. The first, ${failures[0]?.resource.name}, failed with: ${describeError(failures[0]?.error)}`
    )

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
