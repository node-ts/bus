import { Message } from '@node-ts/bus-messages'
import { Container, decorate, inject, injectable, interfaces } from 'inversify'
import { ClassConstructor, isClassConstructor } from '../util/class-constructor'
import { Handler, HandlerPrototype } from './handler'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import * as serializeError from 'serialize-error'

type HandlerType = ClassConstructor<Handler<Message>> | ((context: interfaces.Context) => Handler<Message>)

interface HandlerRegistration<MessageType extends Message> {
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

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
@injectable()
export class HandlerRegistry {

  private registry: HandlerRegistrations = {}
  private container: Container
  private unhandledMessages: MessageName[] = []

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  /**
   * Registers that a function handles a particular message type
   * @param messageName Name of the message to register, from the `$name` property of the message.
   * @param symbol A unique symbol to identify the binding of the message to the function
   * @param handler The function handler to dispatch messages to as they arrive
   * @param messageType The class type of message to handle
   */
  register<TMessage extends Message> (
    messageName: string,
    symbol: symbol,
    handler: HandlerType,
    messageType: ClassConstructor<TMessage>
  ): void {

    if (!this.registry[messageName]) {
      // Register that the message will have subscriptions
      this.registry[messageName] = {
        messageType,
        handlers: []
      }
    }

    const handlerName = getHandlerName(handler)
    const handlerAlreadyRegistered = this.registry[messageName].handlers.some(f => f.symbol === symbol)

    if (handlerAlreadyRegistered) {
      this.logger.warn(`Attempted to re-register a handler that's already registered`, { handlerName })
    } else {
      if (isClassConstructor(handler)) {
        const allRegisteredHandlers = [].concat.apply(
          [],
          Object.keys(this.registry).map(msgName => this.registry[msgName].handlers)
        ) as HandlerBinding[]

        const handlerNameAlreadyRegistered = allRegisteredHandlers
          .some((f: HandlerBinding) => f.handler.name === handler.name)

        if (handlerNameAlreadyRegistered) {
          throw new Error(
            `Attempted to register a handler, when a handler with the same name has already been registered. `
            + `Handlers must be registered with a unique name - "${handler.name}"`
          )
        }

        try {
          // Ensure the handler is available for injection
          decorate(injectable(), handler)
          this.logger.trace(`Handler "${handler.name}" was missing the "injectable()" decorator. `
            + `This has been added automatically`)
        } catch {
          // An error is expected here if the injectable() decorator was attached to the handler
        }
      }
      const handlerDetails: HandlerBinding = {
        symbol,
        handler
      }
      this.registry[messageName].handlers.push(handlerDetails)
      this.logger.info('Handler registered', { messageType: messageName, handler: handlerName })
    }
  }

  /**
   * Gets all registered message handlers for a given message name
   * @param messageName Name of the message to get handlers for, found in the `$name` property of the message
   */
  get<MessageType extends Message> (messageName: string): HandlerRegistration<MessageType>[] {
    if (!(messageName in this.registry)) {
      // No handlers for the given message
      if (!this.unhandledMessages.some(m => m === messageName)) {
        this.unhandledMessages.push(messageName)
        this.logger.warn(`No handlers were registered for message "${messageName}". ` +
          `This could mean that either the handlers haven't been registered with bootstrap.registerHandler(), ` +
          `or that the underlying transport is subscribed to messages that aren't handled and should be removed.`)
      }
      return []
    }
    return this.registry[messageName].handlers.map(h => ({
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
   * Retrieves a list of all messages that have handler registrations
   */
  getMessageNames (): string[] {
    return Object.keys(this.registry)
  }

  /**
   * Returns the class constuctor for a message that has a handler registration
   * @param messageName Message to get a class constructor for
   */
  getMessageConstructor<T extends Message> (messageName: string): ClassConstructor<T> | undefined {
    if (!(messageName in this.registry)) {
      return undefined
    }
    return this.registry[messageName].messageType as ClassConstructor<T>
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
    Object.keys(this.registry).forEach(messageName => {
      const messageHandler = this.registry[messageName]

      messageHandler.handlers.forEach(handlerRegistration => {
        const handlerName = getHandlerName(handlerRegistration.handler)
        this.logger.debug('Binding handler to message', { messageName, handlerName })

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
    })
  }
}

function getHandlerName (handler: HandlerType): string {
  return isClassConstructor(handler)
    ? (handler.prototype as HandlerPrototype).constructor.name
    : handler.constructor.name
}
