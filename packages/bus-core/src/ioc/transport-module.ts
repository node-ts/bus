import { ContainerModule } from 'inversify'

/**
 * A container module containing bindings for a bus transport. These are implemented in
 * individual packages such as `@node-ts/bus-sqs` etc.
 */
export abstract class TransportModule extends ContainerModule {
  readonly name = 'transport'
}
