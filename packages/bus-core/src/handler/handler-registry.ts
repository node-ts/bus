import { Message } from '@node-ts/bus-messages'
import { LoggerFactory } from '../logger'
import { ClassConstructor } from '../util'
import { ClassHandler, Handler, MessageBase } from './handler'

interface RegisteredHandlers {
  messageType: ClassConstructor<MessageBase>
  handlers: Handler[]
}

export interface HandlerRegistrations {
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

export type MessageName = string

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
  get<MessageType extends Message> (loggerFactory: LoggerFactory, message: object): Handler<MessageType>[]

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
   * Gets all registered message handler resolvers
   */
  getResolvers (): HandlerResolver[]

  /**
   * Gets a list of all class based handlers that have been registered
   */
  getClassHandlers (): ClassHandler[]

  /**
   * Removes all handlers from the registry
   */
  reset (): void
}
