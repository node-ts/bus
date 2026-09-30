import { ContainerAdapter } from '../container'
import { HandlerRegistry } from '../handler'
import { LoggerFactory } from '../logger'
import { RetryStrategy } from '../retry-strategy'
import { MessageSerializer, Serializer } from '../serialization'

/**
 * A core set of dependencies that are shared around the service.
 * This is used to provide dependencies to internal and external
 * implementations (eg: transports, persistences) without having
 * them to provide what they need.
 */
export interface CoreDependencies {
  handlerRegistry: HandlerRegistry
  serializer: Serializer
  messageSerializer: MessageSerializer
  loggerFactory: LoggerFactory
  container: ContainerAdapter | undefined
  retryStrategy: RetryStrategy
  interruptSignals: NodeJS.Signals[]
}
