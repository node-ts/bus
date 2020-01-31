import { Message } from '@node-ts/bus-messages'
import { Container, decorate, inject, injectable, interfaces } from 'inversify'
import { ClassConstructor, isClassConstructor } from '../util/class-constructor'
import { Handler, HandlerPrototype, MessageType } from './handler'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import * as serializeError from 'serialize-error'

type HandlerType = ClassConstructor<Handler<Message>> | ((context: interfaces.Context) => Handler<Message>)

export interface HandlerRegistration<MessageType extends Message> {
  defaultContainer: Container
  resolveHandler (handlerContextContainer: Container): Handler<MessageType>
}

interface HandlerBinding {
  symbol: symbol
  handler: HandlerType
}

interface RegisteredHandlers {
  messageType: ClassConstructor<Message>
  handlers: HandlerBinding[]
}

interface HandlerRegistrations {
  [key: string]: RegisteredHandlers
}

type MessageName = string

interface HandlerResolver {
  handler: HandlerType
  symbol: symbol
  resolver (message: unknown): boolean
}

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
@injectable()
export class HandlerRegistry {

  private container: Container
  private unhandledMessages: MessageName[] = []
  private handlerResolvers: HandlerResolver[] = []

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  /**
   * Registers that a function handles a particular message type
   * @param resolver A method that determines which messages should be forwarded to the handler
   * @param symbol A unique symbol to identify the binding of the message to the function
   * @param handler The function handler to dispatch messages to as they arrive
   * @param messageType The class type of message to handle
   */
  register<TMessage extends MessageType = MessageType> (
    resolver: (message: TMessage) => boolean,
    symbol: symbol,
    handler: HandlerType,
    messageType: ClassConstructor<TMessage>
  ): void {

    const handlerName = getHandlerName(handler)

    if (isClassConstructor(handler)) {
      try {
        // Ensure the handler is available for injection
        decorate(injectable(), handler)
        this.logger.trace(`Handler "${handler.name}" was missing the "injectable()" decorator. `
          + `This has been added automatically`)
      } catch {
        // An error is expected here if the injectable() decorator was attached to the handler
      }
    }

    this.handlerResolvers.push({ resolver, symbol, handler })
    this.logger.info('Handler registered', { messageName: messageType.name, handler: handlerName })
  }

  /**
   * Gets all registered message handlers for a given message name
   * @param messageName Name of the message to get handlers for, found in the `$name` property of the message
   */
  get<MessageType extends Message> (message: Message): HandlerRegistration<MessageType>[] {
    const messageName = message.$name

    const resolvedHandlers = this.handlerResolvers
      .filter(resolvers => resolvers.resolver(message))

    if (resolvedHandlers.length === 0) {
      // No handlers for the given message
      if (!this.unhandledMessages.some(m => m === messageName)) {
        this.unhandledMessages.push(messageName)
        this.logger.warn(`No handlers were registered for message "${messageName}". ` +
          `This could mean that either the handlers haven't been registered with bootstrap.registerHandler(), ` +
          `or that the underlying transport is subscribed to messages that aren't handled and should be removed.`)
      }
      return []
    }

    return resolvedHandlers.map(h => ({
      defaultContainer: this.container,
      resolveHandler: (container: Container) => {
        this.logger.debug(`Resolving handlers for ${messageName}`)
        try {
          return container.get<Handler<MessageType>>(h.symbol)
        } catch (error) {
          this.logger.error(
            'Could not resolve handler from the IoC container.',
            {
              messageName,
              error: serializeError(error)
            }
          )
          throw error
        }
      }
    }))
  }

  /**
   * Binds message handlers into the IoC container. All handlers should be stateless and are
   * bound in a transient scope.
   */
  bindHandlersToContainer (container: Container): void {
    this.container = container
    this.bindHandlers()
  }

  /**
   * Retrieves the identity of a handler. This is synonymous with a the handler's class name.
   */
  getHandlerId (handler: Handler<Message>): string {
    return handler.constructor.name
  }

  private bindHandlers (): void {
    this.handlerResolvers.forEach(handlerRegistration => {
      const handlerName = getHandlerName(handlerRegistration.handler)
      this.logger.debug('Binding handler to message', { handlerName })

      if (isClassConstructor(handlerRegistration.handler)) {
        this.container
          .bind<Handler<Message>>(handlerRegistration.symbol)
          .to(handlerRegistration.handler)
          .inTransientScope()
      } else {
        this.container
          .bind<Handler<Message>>(handlerRegistration.symbol)
          .toDynamicValue(handlerRegistration.handler)
          .inTransientScope()
      }
    })
  }
}

function getHandlerName (handler: HandlerType): string {
  return isClassConstructor(handler)
    ? (handler.prototype as HandlerPrototype<MessageType>).constructor.name
    : handler.constructor.name
}
