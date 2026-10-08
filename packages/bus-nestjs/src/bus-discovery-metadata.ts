import { DiscoveryService } from '@nestjs/core'
import { BusRegistrationOptions } from './bus-registration-options'

/**
 * Marks the classes `@BusHandler()` decorates, so `BusModule` can find them with Nest's `DiscoveryService`
 */
export const BUS_HANDLER_METADATA =
  DiscoveryService.createDecorator<BusRegistrationOptions>()

/**
 * Marks the classes `@BusWorkflow()` decorates, so `BusModule` can find them with Nest's `DiscoveryService`
 */
export const BUS_WORKFLOW_METADATA =
  DiscoveryService.createDecorator<BusRegistrationOptions>()
