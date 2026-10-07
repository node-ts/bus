import {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency
} from '@nestjs/common'
import { BusFeature } from './bus-feature'

/**
 * Options for `BusModule.forFeature()`
 */
export interface BusFeatureOptions
  extends BusFeature, Pick<ModuleMetadata, 'imports'> {
  /**
   * The name of the bus to register the handlers and workflows with, as given to `BusModule.forRoot({ name })`
   * @default 'default'
   */
  bus?: string
}

/**
 * Options for `BusModule.forFeatureAsync()`, which declares handlers and workflows with providers injected from
 * Nest's container
 */
export interface BusFeatureAsyncOptions<
  TDependencies extends unknown[] = unknown[]
> extends Pick<ModuleMetadata, 'imports'> {
  /**
   * The name of the bus to register the handlers and workflows with, as given to `BusModule.forRoot({ name })`
   * @default 'default'
   */
  bus?: string
  /**
   * The providers to pass to `useFactory`, in order. They must be singletons, since the factory runs once.
   */
  inject?: (InjectionToken | OptionalFactoryDependency)[]
  /**
   * Declares the handlers and workflows, usually with `handlerFor()` and `defineWorkflow()` closing over the
   * injected providers
   * @example
   * inject: [PaymentGateway],
   * useFactory: (gateway: PaymentGateway) => ({ handlers: [chargeCreditCardHandler(gateway)] })
   */
  useFactory: (
    ...dependencies: TDependencies
  ) => BusFeature | Promise<BusFeature>
}
