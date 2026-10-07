/**
 * Provided, as `true`, by `createBusForProvisioning()`'s application, so each `BusModule` only builds its bus,
 * without initializing, starting or disposing it, and `bus provision` can provision it
 */
export const BUS_PROVISIONING = Symbol('@node-ts/bus-nestjs:provisioning')

/**
 * The global module `createBusForProvisioning()` adds to the application, to provide `BUS_PROVISIONING` to every
 * `BusModule` in it
 */
export class BusProvisioningModule {}
