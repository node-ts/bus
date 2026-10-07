import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common'
import { DiscoveryService, ModuleRef } from '@nestjs/core'
import {
  BusConfiguration,
  BusInstance,
  BusState,
  ClassConstructor,
  Handler,
  isClassHandler
} from '@node-ts/bus-core'
import { serializeError } from 'serialize-error'
import {
  BUS_HANDLER_METADATA,
  BUS_WORKFLOW_METADATA
} from './bus-discovery-metadata'
import { BusFeatureHandler, BusFeatureWorkflow } from './bus-feature'
import {
  BUS_FEATURE_TOKEN_PREFIX,
  BusFeatureRegistration
} from './bus-feature-registration'
import { BusLifecycle } from './bus-module-options'
import { createLazyBus } from './create-lazy-bus'
import {
  BusAlreadyRegistered,
  BusClassNotProvided,
  BusCoreVersionNotSupported,
  BusFeatureNotStatic,
  BusNotRegistered
} from './error'
import { DEFAULT_BUS_NAME } from './get-bus-token'
import { nestContainer } from './nest-container'

type ProviderWrapper = ReturnType<DiscoveryService['getProviders']>[number]

/**
 * What registers handlers or workflows with one bus
 */
interface BusRegistrations {
  handlers: Set<BusFeatureHandler>
  workflows: Set<BusFeatureWorkflow>
  /**
   * What registered them, for errors
   */
  registeredBy: Set<string>
}

const STARTED_STATES = [BusState.Started, BusState.Starting]

/**
 * Gets the class of a decorated provider. A factory or value provider's metatype isn't the class, so it's read from
 * the instance, as Nest's `DiscoveryService` does.
 */
const classOf = (
  wrapper: ProviderWrapper
): ClassConstructor<never> | undefined => {
  const instance: unknown = wrapper.instance
  const type: unknown =
    !wrapper.metatype || wrapper.inject
      ? (instance as object | undefined)?.constructor
      : wrapper.metatype
  return typeof type === 'function'
    ? (type as ClassConstructor<never>)
    : undefined
}

/**
 * Builds one bus `BusModule` registers, and runs its lifecycle from Nest's lifecycle hooks:
 * - `onModuleInit`: finds the handlers and workflows registered with it, and builds it
 * - `onApplicationBootstrap`: initializes it, and starts it if it reads from its transport
 * - `onModuleDestroy`: stops it, so it takes no more messages and finishes those it's handling
 * - `onApplicationShutdown`: disposes it
 *
 * `BusModule` is global, and Nest calls each shutdown hook of global modules after that hook of every module that
 * isn't. So the bus stops after the `onModuleDestroy` of every module that isn't global, and before any module's
 * `beforeApplicationShutdown` and `onApplicationShutdown`, and is disposed after the `onApplicationShutdown` of every
 * module that isn't global. Until it stops, it keeps handling messages and taking new ones. Providers its handlers
 * use should release their resources in `beforeApplicationShutdown` or `onApplicationShutdown`, not
 * `onModuleDestroy`.
 *
 * In an application made by `createBusForProvisioning()`, it only builds the bus.
 */
export class BusLifecycleHost
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    OnModuleDestroy,
    OnApplicationShutdown
{
  /**
   * What's provided as the bus. It passes everything on to the bus once it's built.
   */
  readonly bus: BusInstance
  private builtBus: BusInstance | undefined
  private disposed = false
  private readonly logger = new Logger('@node-ts/bus-nestjs:bus-lifecycle-host')

  /**
   * @param name the bus' name
   * @param configuration the bus' configuration, from `configure` or `useFactory`
   * @param lifecycle whether to initialize and start the bus when the application bootstraps
   * @param provisioning whether the application was made by `createBusForProvisioning()`
   * @param discovery finds the handlers, workflows and buses in the application
   * @param moduleRef resolves class handlers and workflows
   */
  constructor(
    readonly name: string,
    private readonly configuration: BusConfiguration,
    private readonly lifecycle: BusLifecycle,
    private readonly provisioning: boolean,
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef
  ) {
    this.bus = createLazyBus(name, () => this.builtBus)
  }

  /**
   * Builds the bus with the handlers and workflows registered with it
   * @throws BusAlreadyRegistered if another `BusModule.forRoot()` registers a bus with the same name
   * @throws BusNotRegistered if handlers or workflows are registered with a bus that isn't
   * @throws BusFeatureNotStatic if a `forFeatureAsync()` factory injects a request-scoped or transient provider
   * @throws BusClassNotProvided if a class handler or workflow isn't a provider
   * @throws BusCoreVersionNotSupported if the installed @node-ts/bus-core is too old
   */
  onModuleInit(): void {
    const registrations = this.findRegistrations()
    const own = registrations.get(this.name)

    const classes: ClassConstructor<unknown>[] = []
    for (const handler of own?.handlers ?? []) {
      if (typeof handler === 'function') {
        this.configuration.withHandler(handler)
        classes.push(handler)
      } else {
        this.configuration.withHandler(handler)
        if (isClassHandler(handler.messageHandler)) {
          classes.push(handler.messageHandler as ClassConstructor<Handler>)
        }
      }
    }
    const workflows = [...(own?.workflows ?? [])]
    if (workflows.length) {
      this.configuration.withWorkflow(...workflows)
    }
    classes.push(
      ...workflows.filter(
        (workflow): workflow is ClassConstructor<never> =>
          typeof workflow === 'function'
      )
    )
    this.assertProvided(classes)

    const bus = this.configuration
      .withContainer(nestContainer(this.moduleRef))
      .build()
    if (typeof (bus as Partial<BusInstance>).canStart !== 'boolean') {
      throw new BusCoreVersionNotSupported('BusInstance.canStart')
    }
    this.builtBus = bus
  }

  /**
   * Initializes the bus and, if it reads from its transport, starts it, unless its lifecycle is manual. If either
   * fails, it disposes the bus, so its connections don't keep the process running, and rethrows.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.provisioning || this.lifecycle === 'manual') {
      return
    }
    const bus = this.getBuiltBus()
    try {
      await bus.initialize()
      if (bus.canStart) {
        await bus.start()
      }
    } catch (error) {
      try {
        await this.dispose(bus)
      } catch (disposeError) {
        this.logger.error(
          'Failed to dispose the bus after it failed to start',
          {
            bus: this.name,
            error: serializeError(disposeError)
          }
        )
      }
      throw error
    }
  }

  /**
   * Stops the bus, if it's started, waiting for the messages it's handling. It runs after the `onModuleDestroy` of
   * every module that isn't global, since `BusModule` is.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.provisioning || !this.builtBus) {
      return
    }
    if (STARTED_STATES.includes(this.builtBus.state)) {
      await this.builtBus.stop()
    }
  }

  /**
   * Disposes the bus, after the `onApplicationShutdown` of every module that isn't global
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.provisioning || !this.builtBus) {
      return
    }
    await this.dispose(this.builtBus)
  }

  /**
   * Disposes the bus once, whether the application failed to bootstrap or shut down
   */
  private async dispose(bus: BusInstance): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true
    await bus.dispose()
  }

  private getBuiltBus(): BusInstance {
    // onModuleInit always runs first, and builds it or throws
    return this.builtBus as BusInstance
  }

  /**
   * Finds every handler and workflow registered with any bus in the application, by bus name, and checks every bus
   * they're registered with exists, once
   */
  private findRegistrations(): Map<string, BusRegistrations> {
    const registrations = new Map<string, BusRegistrations>()
    const registrationsFor = (busName: string): BusRegistrations => {
      let found = registrations.get(busName)
      if (!found) {
        found = {
          handlers: new Set(),
          workflows: new Set(),
          registeredBy: new Set()
        }
        registrations.set(busName, found)
      }
      return found
    }

    const busNames = new Set<string>()
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance
      if (instance instanceof BusLifecycleHost) {
        if (busNames.has(instance.name)) {
          throw new BusAlreadyRegistered(instance.name)
        }
        busNames.add(instance.name)
      } else if (instance instanceof BusFeatureRegistration) {
        const found = registrationsFor(instance.busName)
        instance.feature.handlers?.forEach(handler =>
          found.handlers.add(handler)
        )
        instance.feature.workflows?.forEach(workflow =>
          found.workflows.add(workflow)
        )
        found.registeredBy.add('BusModule.forFeature()')
      } else {
        this.assertFeatureResolved(wrapper)
      }
    }

    for (const wrapper of this.discovery.getProviders({
      metadataKey: BUS_HANDLER_METADATA.KEY
    })) {
      const handler = classOf(wrapper)
      if (!handler) {
        continue
      }
      const options = this.discovery.getMetadataByDecorator(
        BUS_HANDLER_METADATA,
        wrapper
      )
      const found = registrationsFor(options?.bus ?? DEFAULT_BUS_NAME)
      found.handlers.add(handler)
      found.registeredBy.add(handler.name)
    }
    for (const wrapper of this.discovery.getProviders({
      metadataKey: BUS_WORKFLOW_METADATA.KEY
    })) {
      const workflow = classOf(wrapper)
      if (!workflow) {
        continue
      }
      const options = this.discovery.getMetadataByDecorator(
        BUS_WORKFLOW_METADATA,
        wrapper
      )
      const found = registrationsFor(options?.bus ?? DEFAULT_BUS_NAME)
      found.workflows.add(workflow)
      found.registeredBy.add(workflow.name)
    }

    for (const [busName, { registeredBy }] of registrations) {
      if (!busNames.has(busName)) {
        throw new BusNotRegistered(busName, [...registeredBy])
      }
    }
    return registrations
  }

  /**
   * Checks a `forFeatureAsync()` registration was created. Nest doesn't create a factory provider when it starts if
   * it depends on a request-scoped or transient provider, so its handlers would be silently left out.
   * @throws BusFeatureNotStatic if it wasn't
   */
  private assertFeatureResolved(wrapper: ProviderWrapper): void {
    const token: unknown = wrapper.token
    if (
      typeof token === 'symbol' &&
      token.description?.startsWith(BUS_FEATURE_TOKEN_PREFIX)
    ) {
      throw new BusFeatureNotStatic(
        token.description.slice(BUS_FEATURE_TOKEN_PREFIX.length)
      )
    }
  }

  /**
   * Checks every class handler and workflow is a provider, so the bus can resolve it
   * @throws BusClassNotProvided for the first that isn't
   */
  private assertProvided(classes: ClassConstructor<unknown>[]): void {
    for (const type of classes) {
      try {
        this.moduleRef.introspect(type)
      } catch (error) {
        throw new BusClassNotProvided(type.name, error)
      }
    }
  }
}
