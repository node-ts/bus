import { BusFeature } from './bus-feature'

/**
 * Starts the description of each token `BusModule.forFeature()` and `forFeatureAsync()` provide a registration
 * under, followed by the bus' name, so a registration Nest couldn't create once can still be named in an error
 */
export const BUS_FEATURE_TOKEN_PREFIX = '@node-ts/bus-nestjs:feature:'

/**
 * The handlers and workflows `BusModule.forFeature()` or `forFeatureAsync()` register with a bus, provided under a
 * token of their own so each bus can find them with Nest's `DiscoveryService`
 */
export class BusFeatureRegistration {
  /**
   * @param busName the bus to register them with
   * @param feature the handlers and workflows
   */
  constructor(
    readonly busName: string,
    readonly feature: BusFeature
  ) {}
}
