import { BusConfiguration } from '../service-bus'
import { BusContainer } from '../bus-container'
import { BUS_SYMBOLS, BUS_INTERNAL_SYMBOLS } from '../bus-symbols'
import { TransportModule } from './transport-module'
import { TransportConfiguration } from '../transport'
import { ClassConstructor } from '../util'
import { Handler, MessageType } from '../handler'
import { ApplicationBootstrap } from '../application-bootstrap'
import { ContainerProvider } from './container-provider'

/**
 * A consumer bootstrap provider that allows configuration and module loading of `@node-ts/bus` modules
 * without a consumer IoC dependency.
 */
export abstract class BusBootstrap {
  /**
   * Configures `@node-ts/bus` to be configured using @param configuration
   */
  static withConfiguration (configuration: BusConfiguration): typeof BusBootstrap {
    BusContainer.instance.rebind(BUS_SYMBOLS.BusConfiguration).toConstantValue(configuration)
    return BusBootstrap
  }

  /**
   * Configures `@node-ts/bus` to use a different transport provider
   */
  static withTransport (
    module: TransportModule,
    transportConfiguration?: TransportConfiguration
  ): typeof BusBootstrap {
    BusContainer.instance.load(module)
    if (transportConfiguration) {
      BusContainer.instance.rebind(BUS_SYMBOLS.TransportConfiguration).toConstantValue(transportConfiguration)
    }
    return BusBootstrap
  }

  /**
   * Registers a provider that fetches services from an application-specific IoC container.
   */
  static withContainer (containerProvider: ContainerProvider): typeof BusBootstrap {
    BusContainer.instance.bind(BUS_INTERNAL_SYMBOLS.ContainerProvider).toConstantValue(containerProvider)
    return BusBootstrap
  }

  /**
   * Registers a handler with bus. This will subscribe the application queue to the topic where this message is
   * published to, and then forward any received messages of this type to the handler.
   */
  static withHandler (messageHandler: ClassConstructor<Handler<MessageType>>): typeof BusBootstrap {
    const applicationBootstrap = BusContainer.instance.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    applicationBootstrap.registerHandler(messageHandler)
    return BusBootstrap
  }

  /**
   * Initializes the `@node-ts/bus` system
   */
  static async initialize (): Promise<ApplicationBootstrap> {
    const applicationBootstrap = BusContainer.instance.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await applicationBootstrap.initialize(BusContainer.instance)
    return applicationBootstrap
  }

  /**
   * Initializes the `@node-ts/bus` system in send-only mode
   */
  static async initializeReadOnly (): Promise<ApplicationBootstrap> {
    const applicationBootstrap = BusContainer.instance.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await applicationBootstrap.initializeSendOnly()
    return applicationBootstrap
  }

  static async dispose (): Promise<typeof BusBootstrap> {
    const applicationBootstrap = BusContainer.instance.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await applicationBootstrap.dispose()
    BusContainer.dispose()
    return BusBootstrap
  }
}
