import { Message } from '@node-ts/bus-messages'
import { getLogger } from '../logger'
import { ClassConstructor } from '../util'
import { HandlerAlreadyRegistered, SystemMessageMissingResolver } from './errors'
import { ClassHandler, Handler, isClassHandler, MessageBase } from './handler'

const logger = () => getLogger('@node-ts/bus-core:handler-registry')

interface RegisteredHandlers {
  messageType: ClassConstructor<MessageBase>
  handlers: Handler[]
}

interface HandlerRegistrations {
  [key: string]: RegisteredHandlers
}

/**
 * Provide a way for externally managed messages to be handled
 * by the Bus
 */
export interface CustomResolver<MessageType> {
  /**
   * A resolver function that will be executed for each read message
   * to determine if it's to be handled by the handler declaring this resolver
   */
  resolveWith: ((message: MessageType) => boolean),

  /**
   * If provided, will attempt to subscribe the queue to this topic.
   * If not provided, assumes that the queue will be subscribed to the topic manually.
   */
  topicIdentifier?: string
}

export interface HandlerResolver {
  handler: Handler
  resolver (message: unknown): boolean
  messageType: ClassConstructor<MessageBase> | undefined
  topicIdentifier: string | undefined
}

type MessageName = string

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
export interface HandlerRegistry {
  /**
   * Registers that a function handles a particular message type
   * @param messageType The class type of message to handle
   * @param handler The function handler to dispatch messages to as they arrive
   * @param customResolver An optional custom resolver that will be used instead
   * of the default @node-ts/bus-messages/Message behaviour in terms of matching
   * incoming messages to handlers.
   */
  register<TMessage extends MessageBase> (
    messageType: ClassConstructor<TMessage>,
    handler: Handler<TMessage>
  ): void

  registerCustom<TMessage extends MessageBase> (
    handler: Handler<TMessage>,
    customResolver: CustomResolver<TMessage>
  ): void

  /**
   * Gets all registered message handlers for a given message name
   * @param message A message that has been received from the bus
   */
  get<MessageType extends Message> (message: object): Handler<MessageType>[]

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
   * Retrieves an array of all topic arns that are managed externally but require subscribing to as there are
   * custom handlers that handle those messages.
   */
  getExternallyManagedTopicIdentifiers (): string[]

  /**
   * Gets a list of all class based handlers that have been registered
   */
  getClassHandlers (): ClassHandler[]

  /**
   * Removes all handlers from the registry
   */
  reset (): void
}

class DefaultHandlerRegistry implements HandlerRegistry {

  private registry: HandlerRegistrations = {}
  private unhandledMessages: MessageName[] = []
  private handlerResolvers: HandlerResolver[] = []

  registerCustom<TMessage extends MessageBase> (
    handler: Handler<TMessage>,
    customResolver: CustomResolver<TMessage>
  ): void {
    this.handlerResolvers.push({
      handler,
      messageType: undefined,
      resolver: customResolver.resolveWith,
      topicIdentifier: customResolver.topicIdentifier
    })
    logger().info('Custom handler registered', { handler: handler.name })
  }

  register<TMessage extends MessageBase> (
    messageType: ClassConstructor<TMessage>,
    handler: Handler<TMessage>,
  ): void {

    const message = new messageType()
    if (!('$name' in message)) {
      throw new SystemMessageMissingResolver(messageType)
    }
    const messageName = message.$name

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
    logger().info('Handler registered', { messageType: messageName, handler: handler.name })
  }

  get<MessageType extends MessageBase> (message: object | Message): Handler<MessageType>[] {
    const customHandlers = this.resolveCustomHandlers(message)

    const messageName = '$name' in message
      ? message.$name
      : undefined

    const noHandlersForMessage = !customHandlers.length && (!messageName || !(messageName in this.registry))
    if (noHandlersForMessage) {

      const warnNoHandlersForMessageType = messageName && !this.unhandledMessages.some(m => m === messageName)
      if (warnNoHandlersForMessageType) {
        this.unhandledMessages.push(messageName!)
        logger().error(
          `No handlers were registered for message`,
          {
            messageName,
            help: `This could mean that either the handlers haven't been registered with bootstrap.registerHandler(),`
            + ` or that the underlying transport is subscribed to messages that aren't handled and should be removed.`
          })
      }

      return []
    }

    const messageHandlers = messageName && this.registry[messageName]
      ? this.registry[messageName].handlers
      : []

    return [
      ...messageHandlers,
      ...customHandlers
    ]
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

  getExternallyManagedTopicIdentifiers (): string[] {
    return this.handlerResolvers
      .map(resolver => resolver.topicIdentifier)
      .filter(topicArn => !!topicArn) as string[]
  }

  reset (): void {
    this.registry = {}
  }

  getClassHandlers (): ClassHandler[] {
    const customHandlers = this.handlerResolvers
      .map(handlerResolver => handlerResolver.handler)
      .filter(isClassHandler) as unknown as ClassHandler[]

    const regularHandlers = Object.values(this.registry)
      .map(h => h.handlers)
      .flat()
      .filter(isClassHandler) as unknown as ClassHandler[]

    return [
      ...customHandlers,
      ...regularHandlers
    ]
  }

  /**
   * Returns a list of handlers that have been matched via custom resolvers for a message
   * @param message A message that has been fetched from the bus. Note that this may or may not
   * adhere to @node-ts/bus-messages/Message contracts, and could be any externally generated message.
   */
  private resolveCustomHandlers<MessageType extends MessageBase> (message: object): Handler<MessageType>[] {
    return this.handlerResolvers
      .filter(handlerResolver => handlerResolver.resolver(message))
      .map(handlerResolver => handlerResolver.handler)
  }
}

export const handlerRegistry: HandlerRegistry = new DefaultHandlerRegistry()
