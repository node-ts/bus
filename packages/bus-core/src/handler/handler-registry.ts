import { Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util/class-constructor'
import { getLogger } from '../service-bus/logger'
import { HandlerAlreadyRegistered } from './errors'
import { Handler } from './handler'

interface RegisteredHandlers {
  messageType: ClassConstructor<Message>
  handlers: Handler[]
}

interface HandlerRegistrations {
  [key: string]: RegisteredHandlers
}

type MessageName = string

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
export interface HandlerRegistry {
  /**
   * Registers that a function handles a particular message type
   * @param messageName Name of the message to register, from the `$name` property of the message.
   * @param symbol A unique symbol to identify the binding of the message to the function
   * @param handler The function handler to dispatch messages to as they arrive
   * @param messageType The class type of message to handle
   */
  register<TMessage extends Message> (
    messageType: ClassConstructor<TMessage>,
    handler: Handler<TMessage>
  ): void

  /**
   * Gets all registered message handlers for a given message name
   * @param messageName Name of the message to get handlers for, found in the `$name` property of the message
   */
  get<MessageType extends Message> (messageName: string): Handler<MessageType>[]

  /**
   * Retrieves a list of all messages that have handler registrations
   */
  getMessageNames (): string[]

  /**
   * Returns the class constructor for a message that has a handler registration
   * @param messageName Message to get a class constructor for
   */
  getMessageConstructor<TMessage extends Message> (messageName: string): ClassConstructor<TMessage> | undefined

  /**
   * Retrieves the identity of a handler. This is synonymous with a the handler's class name.
   */
  getHandlerId (handler: Handler<Message>): string
}

class DefaultHandlerRegistry implements HandlerRegistry {

  private registry: HandlerRegistrations = {}
  private unhandledMessages: MessageName[] = []

  register<TMessage extends Message> (
    messageType: ClassConstructor<TMessage>,
    handler: Handler<TMessage>
  ): void {

    const messageName = new messageType().$name

    if (!this.registry[messageName]) {
      // Register that the message will have subscriptions
      this.registry[messageName] = {
        messageType,
        handlers: []
      }
    }

    const handlerNameAlreadyRegistered = this.registry[messageName].handlers
      .some(registeredHandler => registeredHandler === handler)

    if (handlerNameAlreadyRegistered) {
      throw new HandlerAlreadyRegistered(handler.name)
    }

    this.registry[messageName].handlers.push(handler)
    getLogger().info('Handler registered', { messageType: messageName, handler: handler.name })
  }

  get<MessageType extends Message> (messageName: string): Handler<MessageType>[] {
    if (!(messageName in this.registry)) {
      // No handlers for the given message
      if (!this.unhandledMessages.some(m => m === messageName)) {
        this.unhandledMessages.push(messageName)
        getLogger().error(
          `No handlers were registered for message`,
          {
            messageName,
            help: `This could mean that either the handlers haven't been registered with bootstrap.registerHandler(),`
            + ` or that the underlying transport is subscribed to messages that aren't handled and should be removed.`
          })
      }
      return []
    }
    return this.registry[messageName].handlers
  }

  getMessageNames (): string[] {
    return Object.keys(this.registry)
  }

  getMessageConstructor<T extends Message> (messageName: string): ClassConstructor<T> | undefined {
    if (!(messageName in this.registry)) {
      return undefined
    }
    return this.registry[messageName].messageType as ClassConstructor<T>
  }

  getHandlerId (handler: Handler): string {
    return handler.constructor.name
  }
}

export const handlerRegistry: HandlerRegistry = new DefaultHandlerRegistry()
