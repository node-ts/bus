import { Message, MessageDeclaration } from '@node-ts/bus-messages'
import { LoggerFactory } from '../logger'
import { ClassConstructor } from '../util'
import { Handler, HandlerDefinition, MessageBase } from './handler'

interface RegisteredHandlers {
  messageType: MessageDeclaration<Message>
  handlers: HandlerDefinition[]
}

export interface HandlerRegistrations {
  [key: string]: RegisteredHandlers
}

/**
 * Provide a way for externally managed messages to be handled
 * by the Bus
 */
export interface CustomResolver<MessageType = any> {
  /**
   * A resolver function that will be executed for each read message
   * to determine if it's to be handled by the handler declaring this resolver
   */
  resolveWith: (message: MessageType) => boolean

  /**
   * If provided, will attempt to subscribe the queue to this topic.
   * If not provided, assumes that the queue will be subscribed to the topic manually.
   */
  topicIdentifier?: string
}

export interface HandlerResolver {
  handler: HandlerDefinition
  resolver(message: unknown): boolean
  messageType: ClassConstructor<MessageBase> | undefined
  topicIdentifier: string | undefined
}

export type MessageName = string

/**
 * An internal singleton that contains all registrations of messages to functions that handle
 * those messages.
 */
export interface HandlerRegistry {
  /**
   * Registers that a function handles a particular message type. The message's name is read from the
   * static `NAME` of `messageType`, without constructing it.
   * @param messageType The message class, or the definition from `defineCommand` or `defineEvent`, to handle
   * @param handler The function handler to dispatch messages to as they arrive
   * @throws MessageNameMissing if `messageType` has no static `NAME`
   */
  register<TMessage extends Message>(
    messageType: MessageDeclaration<TMessage>,
    handler: HandlerDefinition<TMessage>
  ): void

  registerCustom<TMessage extends MessageBase>(
    handler: HandlerDefinition<TMessage>,
    customResolver: CustomResolver<TMessage>
  ): void

  /**
   * Gets all registered message handlers for a given message name
   * @param message A message that has been received from the bus
   */
  get<MessageType extends Message>(
    loggerFactory: LoggerFactory,
    message: object
  ): HandlerDefinition<MessageType>[]

  /**
   * Retrieves a list of all messages that have handler registrations
   */
  getMessageNames(): string[]

  /**
   * Returns the class that received messages are created from, for a message that has a handler
   * registration. That's the message class, or `Object` for a message declared with `defineCommand`
   * or `defineEvent`, whose messages are plain objects.
   * @param messageName Message to get a class constructor for
   */
  getMessageConstructor<TMessage extends Message>(
    messageName: string
  ): ClassConstructor<TMessage> | undefined

  /**
   * Retrieves an array of all topic arns that are managed externally but require subscribing to as there are
   * custom handlers that handle those messages.
   */
  getExternallyManagedTopicIdentifiers(): string[]

  /**
   * Gets all registered message handler resolvers
   */
  getResolvers(): HandlerResolver[]

  /**
   * Gets a list of all class based handlers that have been registered
   */
  getClassHandlers(): Handler[]

  /**
   * Removes all handlers from the registry
   */
  reset(): void
}
