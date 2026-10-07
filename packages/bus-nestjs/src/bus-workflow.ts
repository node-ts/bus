import { ClassConstructor, Workflow } from '@node-ts/bus-core'
import { BUS_WORKFLOW_METADATA } from './bus-discovery-metadata'
import { BusRegistrationOptions } from './bus-registration-options'

/**
 * Registers a class workflow that's a Nest provider with a bus, which resolves it from Nest's container when it
 * reads the workflow's `configureWorkflow()` and for each message it handles. Only classes that extend `Workflow`
 * can be decorated. The class must still be in a module's `providers`. Workflows declared with `defineWorkflow()`
 * are registered with `BusModule.forFeature()` instead.
 * @param options which bus to register it with
 * @example
 * ```ts
 * @BusWorkflow()
 * @Injectable()
 * export class ShippingWorkflow extends Workflow<ShippingState> {
 *   ...
 * }
 * ```
 */
export const BusWorkflow =
  (options?: BusRegistrationOptions) =>
  <TWorkflow extends ClassConstructor<Workflow<any>>>(
    target: TWorkflow
  ): void => {
    BUS_WORKFLOW_METADATA(options)(target)
  }
