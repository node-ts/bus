import { Message } from '@node-ts/bus-messages'
import { Container, decorate, inject, injectable } from 'inversify'
import { ClassConstructor, isClassConstructor } from '../util/class-constructor'
import { Handler, HandlerPrototype } from './handler'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'

type HandlerType = ClassConstructor<Handler<Message>> | (() => Handler<Message>)

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

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
@injectable()
export class HandlerRegistry {

  private registry: HandlerRegistrations = {}
  private container: Container
  private unhandledMessages: string[] = []

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  /**
   * Registers a function handler for a message
   * @param messageName Name of the message to register, from the `$name` property of the message.
   * @param symbol A unique symbol to identify the registration mapping
   * @param handler A function handler to dispatch messages to as they arrive
   * @param messageType The class type of message to handle
   */
  register<TMessage extends Message> (
    messageName: string,
    symbol: symbol,
    handler: HandlerType,
    messageType: ClassConstructor<TMessage>
  ): void {

    if (!this.registry[messageName]) {
      this.registry[messageName] = {
        messageType,
        handlers: []
      }
    }

    const constructorName = getHandlerConstructorName(handler)
    const handlerAlreadyRegistered = this.registry[messageName].handlers.some(f => f.symbol === symbol)

    if (handlerAlreadyRegistered) {
      this.logger.warn('Handler attempted to be re-registered', { handlerName: constructorName })
    } else {
      if (isClassConstructor(handler)) {
        const registeredHandlers = [].concat.apply(
          [],
          Object.keys(this.registry).map(k => this.registry[k].handlers)
        ) as HandlerBinding[]

        const handlerNameAlreadyRegistered = registeredHandlers
          .some((f: HandlerBinding) => f.handler.name === handler.name)

        if (handlerNameAlreadyRegistered) {
          throw new Error(
            `Attempted to register multiple handlers with the same name ("${handler.name}").`
            + `Handler names must be unique`
          )
        }
        try {
          decorate(injectable(), handler)
        } catch (error) {
          this.logger.debug('Handler already already has the "injectable()" decorator attached')
        }
      } else {
        throw new Error(`Handler should be a class type (${handler})`)
      }
      const handlerDetails: HandlerBinding = {
        symbol,
        handler
      }
      this.registry[messageName].handlers.push(handlerDetails)
      this.logger.info('Handler registered', { messageType: messageName, handler: constructorName })
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
        this.logger.debug(`Resolving ${messageName}`)
        try {
          return container.get<Handler<MessageType>>(h.symbol)
        } catch (error) {
          this.logger.error('Could not resolve instance of handler.', { messageType: messageName, error })
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
        const handlerName = getHandlerConstructorName(handlerRegistration.handler)
        this.logger.info('Binding handler for message.', { messageName, handlerName })

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

function getHandlerConstructorName (handler: HandlerType): string {
  return isClassConstructor(handler)
    ? (handler.prototype as HandlerPrototype).constructor.name
    : handler.constructor.name
}
