import {
  CustomResolver,
  HandlerRegistrations,
  HandlerRegistry,
  HandlerResolver,
  MessageName
} from './handler-registry'
import { HandlerAlreadyRegistered, SystemMessageMissingResolver } from './error'
import {
  Handler,
  HandlerDefinition,
  isClassHandler,
  MessageBase
} from './handler'
import { ClassConstructor } from '../util'
import { Message } from '@node-ts/bus-messages'
import { LoggerFactory } from '../logger'

export class DefaultHandlerRegistry implements HandlerRegistry {
  private registry: HandlerRegistrations = {}
  private unhandledMessages: MessageName[] = []
  private handlerResolvers: HandlerResolver[] = []

  registerCustom<TMessage extends MessageBase>(
    handler: HandlerDefinition<TMessage>,
    customResolver: CustomResolver<TMessage>
  ): void {
    this.handlerResolvers.push({
      handler,
      messageType: undefined,
      resolver: customResolver.resolveWith,
      topicIdentifier: customResolver.topicIdentifier
    })
  }

  register<TMessage extends MessageBase>(
    messageType: ClassConstructor<TMessage>,
    handler: HandlerDefinition<TMessage>
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

    const handlerNameAlreadyRegistered = this.registry[
      messageName
    ].handlers.some(registeredHandler => registeredHandler === handler)

    if (handlerNameAlreadyRegistered) {
      throw new HandlerAlreadyRegistered(handler.name)
    }

    this.registry[messageName].handlers.push(handler)
  }

  get<MessageType extends MessageBase>(
    loggerFactory: LoggerFactory,
    message: MessageBase
  ): HandlerDefinition<MessageType>[] {
    const logger = loggerFactory('@node-ts/bus-core:handler-registry')
    logger.debug('Getting handlers for message', { msg: message })
    const customHandlers = this.resolveCustomHandlers(message)

    const messageName = '$name' in message ? message.$name : undefined

    const noHandlersForMessage =
      !customHandlers.length &&
      (!messageName || !(messageName in this.registry))
    if (noHandlersForMessage) {
      const warnNoHandlersForMessageType =
        messageName && !this.unhandledMessages.some(m => m === messageName)
      if (warnNoHandlersForMessageType) {
        this.unhandledMessages.push(messageName!)
        logger.error(`No handlers were registered for message`, {
          messageName,
          help:
            `This could mean that either the handlers haven't been registered with bootstrap.registerHandler(),` +
            ` or that the underlying transport is subscribed to messages that aren't handled and should be removed.`
        })
      }

      logger.debug('No handlers found for message', { msg: message })
      return []
    }

    const messageHandlers =
      messageName && this.registry[messageName]
        ? this.registry[messageName].handlers
        : []

    logger.debug('Found handlers for message', {
      msg: message,
      numMessageHandlers: messageHandlers.length,
      numCustomHandlers: customHandlers.length
    })
    const result = [...messageHandlers, ...customHandlers]
    return result as HandlerDefinition<MessageType>[]
  }

  getMessageNames(): string[] {
    return Object.keys(this.registry)
  }

  getMessageConstructor<T extends Message>(
    messageName: string
  ): ClassConstructor<T> | undefined {
    if (!(messageName in this.registry)) {
      return undefined
    }
    return this.registry[messageName].messageType as ClassConstructor<T>
  }

  getExternallyManagedTopicIdentifiers(): string[] {
    return this.handlerResolvers
      .map(resolver => resolver.topicIdentifier)
      .filter(topicArn => !!topicArn) as string[]
  }

  getResolvers(): HandlerResolver[] {
    return this.handlerResolvers
  }

  reset(): void {
    this.registry = {}
  }

  getClassHandlers(): Handler[] {
    const customHandlers = this.handlerResolvers
      .map(handlerResolver => handlerResolver.handler)
      .filter(isClassHandler) as unknown as Handler[]

    const regularHandlers = Object.values(this.registry)
      .map(h => h.handlers)
      .flat()
      .filter(isClassHandler) as unknown as Handler[]

    return [...customHandlers, ...regularHandlers]
  }

  /**
   * Returns a list of handlers that have been matched via custom resolvers for a message
   * @param message A message that has been fetched from the bus. Note that this may or may not
   * adhere to @node-ts/bus-messages/Message contracts, and could be any externally generated message.
   */
  private resolveCustomHandlers<MessageType extends MessageBase>(
    message: object
  ): HandlerDefinition<MessageType>[] {
    return this.handlerResolvers
      .filter(handlerResolver => handlerResolver.resolver(message))
      .map(
        handlerResolver => handlerResolver.handler
      ) as HandlerDefinition<MessageType>[]
  }
}
