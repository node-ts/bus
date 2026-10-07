import { DynamicModule, Provider } from '@nestjs/common'
import { DiscoveryModule, DiscoveryService, ModuleRef } from '@nestjs/core'
import { Bus } from '@node-ts/bus-core'
import {
  BusFeatureAsyncOptions,
  BusFeatureOptions
} from './bus-feature-options'
import {
  BUS_FEATURE_TOKEN_PREFIX,
  BusFeatureRegistration
} from './bus-feature-registration'
import { BusLifecycleHost } from './bus-lifecycle-host'
import { BusModuleAsyncOptions, BusModuleOptions } from './bus-module-options'
import { BUS_PROVISIONING } from './bus-provisioning'
import { DEFAULT_BUS_NAME, getBusToken } from './get-bus-token'
import { nestLoggerFactory } from './nest-logger-factory'

/**
 * Runs a bus in a NestJS application. `forRoot()` or `forRootAsync()`, imported once in the root module,
 * registers the bus, which is injected as `BusInstance` anywhere in the application. Feature modules register
 * their handlers and workflows with `forFeature()` or `forFeatureAsync()`, or class handlers and workflows that are
 * providers can be decorated with `@BusHandler()` and `@BusWorkflow()`. Class handlers and workflows are resolved
 * from Nest's container for each message.
 *
 * The bus is built when the application initializes, initialized and started when it bootstraps, stopped when it
 * starts shutting down and disposed once it has. Call `app.enableShutdownHooks()` so a SIGTERM shuts it down
 * gracefully.
 * @example
 * ```ts
 * @Module({
 *   imports: [
 *     BusModule.forRoot({
 *       configure: bus => bus.withTransport(new RabbitMqTransport(configuration)).withMessageTypes(messageTypes)
 *     }),
 *     PaymentsModule
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
export class BusModule {
  /**
   * Registers a bus, configured by a function
   * @param options how to configure the bus
   * @returns a global module that provides the bus
   * @example
   * BusModule.forRoot({ configure: bus => bus.withTransport(transport).withMessageTypes(messageTypes) })
   */
  static forRoot(options: BusModuleOptions): DynamicModule {
    return BusModule.forRootAsync({
      name: options.name,
      lifecycle: options.lifecycle,
      useFactory: bus => options.configure(bus)
    })
  }

  /**
   * Registers a bus, configured by a factory that's given providers from Nest's container
   * @param options how to configure the bus, and the providers to configure it with
   * @returns a global module that provides the bus
   * @example
   * BusModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (bus, config: ConfigService) =>
   *     bus.withTransport(new SqsTransport({ queueName: config.getOrThrow('QUEUE_NAME') })).withMessageTypes(messageTypes)
   * })
   */
  static forRootAsync<TDependencies extends unknown[]>(
    options: BusModuleAsyncOptions<TDependencies>
  ): DynamicModule {
    const name = options.name ?? DEFAULT_BUS_NAME
    const hostToken = Symbol(`@node-ts/bus-nestjs:lifecycle:${name}`)
    const busToken = getBusToken(name)

    const providers: Provider[] = [
      {
        provide: hostToken,
        inject: [
          DiscoveryService,
          ModuleRef,
          { token: BUS_PROVISIONING, optional: true },
          ...(options.inject ?? [])
        ],
        useFactory: async (
          discovery: DiscoveryService,
          moduleRef: ModuleRef,
          provisioning: boolean | undefined,
          ...dependencies: unknown[]
        ) => {
          // Nest's shutdown hooks stop the bus, so the bus doesn't listen for signals itself
          const seed = Bus.configure()
            .withLogger(nestLoggerFactory)
            .withInterruptSignals([])
          const configuration = await options.useFactory(
            seed,
            ...(dependencies as TDependencies)
          )
          return new BusLifecycleHost(
            name,
            configuration,
            options.lifecycle ?? 'auto',
            provisioning === true,
            discovery,
            moduleRef
          )
        }
      },
      {
        provide: busToken,
        inject: [hostToken],
        useFactory: (host: BusLifecycleHost) => host.bus
      }
    ]

    return {
      module: BusModule,
      global: true,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers,
      exports: [busToken]
    }
  }

  /**
   * Registers handlers and workflows with a bus. Class handlers and workflows are also registered as providers of
   * the module this returns, so pass the modules that export their dependencies in `imports`.
   * @param options the handlers and workflows, and the bus to register them with
   * @returns a module to import in the feature module
   * @example
   * BusModule.forFeature({ handlers: [ChargeCreditCardHandler, refundHandler], workflows: [shippingWorkflow] })
   */
  static forFeature(options: BusFeatureOptions): DynamicModule {
    const { bus, imports, ...feature } = options
    const busName = bus ?? DEFAULT_BUS_NAME
    const classes = [
      ...(feature.handlers ?? []),
      ...(feature.workflows ?? [])
    ].filter(registered => typeof registered === 'function')

    return {
      module: BusModule,
      imports: imports ?? [],
      providers: [
        ...classes,
        {
          provide: Symbol(`${BUS_FEATURE_TOKEN_PREFIX}${busName}`),
          useValue: new BusFeatureRegistration(busName, feature)
        }
      ]
    }
  }

  /**
   * Registers handlers and workflows with a bus, declared by a factory that's given providers from Nest's
   * container, such as function handlers that close over them. The factory runs once, so it can only inject
   * singletons.
   * @param options the factory, the providers to give it, and the bus to register them with
   * @returns a module to import in the feature module
   * @example
   * BusModule.forFeatureAsync({
   *   imports: [PaymentGatewayModule],
   *   inject: [PaymentGateway],
   *   useFactory: (gateway: PaymentGateway) => ({ handlers: [chargeCreditCardHandler(gateway)] })
   * })
   */
  static forFeatureAsync<TDependencies extends unknown[]>(
    options: BusFeatureAsyncOptions<TDependencies>
  ): DynamicModule {
    const busName = options.bus ?? DEFAULT_BUS_NAME
    return {
      module: BusModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: Symbol(`${BUS_FEATURE_TOKEN_PREFIX}${busName}`),
          inject: options.inject ?? [],
          useFactory: async (...dependencies: unknown[]) =>
            new BusFeatureRegistration(
              busName,
              await options.useFactory(...(dependencies as TDependencies))
            )
        }
      ]
    }
  }
}
