import {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency
} from '@nestjs/common'
import { BusConfiguration } from '@node-ts/bus-core'

/**
 * When `BusModule` runs the bus' lifecycle:
 * - `auto`: it initializes and starts the bus when the application bootstraps (`onApplicationBootstrap`)
 * - `manual`: the application calls `bus.initialize()` and `bus.start()` itself, such as after `app.listen()`
 *
 * Either way, it stops the bus when the application starts shutting down (`onModuleDestroy`), and disposes it
 * once the application has shut down (`onApplicationShutdown`).
 */
export type BusLifecycle = 'auto' | 'manual'

/**
 * Options for `BusModule.forRoot()`
 */
export interface BusModuleOptions {
  /**
   * The name of the bus, to inject it with `@InjectBus(name)` and register handlers with it with
   * `BusModule.forFeature({ bus: name })`, when the application has several
   * @default 'default'
   */
  name?: string
  /**
   * Configures the bus. It's given a configuration with Nest's logger and no interrupt signals, so Nest's
   * shutdown hooks stop the bus, and returns it with the bus' transport, persistence, message types and anything
   * else. `BusModule` adds the handlers and workflows of every feature, and a container backed by Nest's, then
   * builds it.
   * @example
   * configure: bus => bus.withTransport(new RabbitMqTransport(configuration)).withMessageTypes(messageTypes)
   */
  configure: (
    bus: BusConfiguration
  ) => BusConfiguration | Promise<BusConfiguration>
  /**
   * When `BusModule` initializes and starts the bus
   * @default 'auto'
   */
  lifecycle?: BusLifecycle
}

/**
 * Options for `BusModule.forRootAsync()`, which configures the bus with providers injected from Nest's container
 */
export interface BusModuleAsyncOptions<
  TDependencies extends unknown[] = unknown[]
> extends Pick<ModuleMetadata, 'imports'> {
  /**
   * The name of the bus, to inject it with `@InjectBus(name)` and register handlers with it with
   * `BusModule.forFeature({ bus: name })`, when the application has several
   * @default 'default'
   */
  name?: string
  /**
   * The providers to pass to `useFactory`, after the configuration, in order
   */
  inject?: (InjectionToken | OptionalFactoryDependency)[]
  /**
   * Configures the bus. It's given a configuration with Nest's logger and no interrupt signals, so Nest's
   * shutdown hooks stop the bus, then the providers in `inject`, and returns the configuration with the bus'
   * transport, persistence, message types and anything else. `BusModule` adds the handlers and workflows of every
   * feature, and a container backed by Nest's, then builds it.
   * @example
   * inject: [ConfigService],
   * useFactory: (bus, config: ConfigService) =>
   *   bus.withTransport(new SqsTransport({ queueName: config.getOrThrow('QUEUE_NAME') }))
   */
  useFactory: (
    bus: BusConfiguration,
    ...dependencies: TDependencies
  ) => BusConfiguration | Promise<BusConfiguration>
  /**
   * When `BusModule` initializes and starts the bus
   * @default 'auto'
   */
  lifecycle?: BusLifecycle
}
