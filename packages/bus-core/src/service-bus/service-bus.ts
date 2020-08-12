import { injectable, inject, optional } from 'inversify'
import autobind from 'autobind-decorator'
import { Bus, BusState, HookAction, HookCallback } from './bus'
import { BUS_SYMBOLS, BUS_INTERNAL_SYMBOLS } from '../bus-symbols'
import { Transport, TransportMessage } from '../transport'
import { Event, Command, MessageAttributes, Message } from '@node-ts/bus-messages'
import { Logger, LOGGER_SYMBOLS } from '@node-ts/logger-core'
import { sleep } from '../util'
import { HandlerRegistry, HandlerRegistration } from '../handler'
import * as serializeError from 'serialize-error'
import { SessionScopeBinder } from '../bus-module'
import { MessageType } from '../handler/handler'
import { BusHooks } from './bus-hooks'
import { FailMessageOutsideHandlingContext } from '../error'

@injectable()
@autobind
export class ServiceBus implements Bus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0

  constructor (
    @inject(BUS_SYMBOLS.Transport) private readonly transport: Transport<{}>,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.HandlerRegistry) private readonly handlerRegistry: HandlerRegistry,
    @inject(BUS_SYMBOLS.MessageHandlingContext) private readonly messageHandlingContext: MessageAttributes,
    @inject(BUS_INTERNAL_SYMBOLS.BusHooks) private readonly busHooks: BusHooks,
    @optional() @inject(BUS_INTERNAL_SYMBOLS.RawMessage) private readonly rawMessage: TransportMessage<unknown>
  ) {
  }

  async publish<TEvent extends Event> (
    event: TEvent,
    messageOptions: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    this.logger.debug('publish', { event })
    const transportOptions = this.prepareTransportOptions(messageOptions)

    await Promise.all(this.busHooks.publish.map(callback => callback(event, messageOptions)))
    return this.transport.publish(event, transportOptions)
  }

  async fail (): Promise<void> {
    if (!this.rawMessage) {
      throw new FailMessageOutsideHandlingContext(this.rawMessage)

    }
    this.logger.debug('failing message', { message: this.rawMessage })
    return this.transport.fail(this.rawMessage)
  }

  async send<TCommand extends Command> (
    command: TCommand,
    messageOptions: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    this.logger.debug('send', { command })
    const transportOptions = this.prepareTransportOptions(messageOptions)

    await Promise.all(this.busHooks.send.map(callback => callback(command, messageOptions)))
    return this.transport.send(command, transportOptions)
  }

  async start (): Promise<void> {
    if (this.internalState !== BusState.Stopped) {
      throw new Error('ServiceBus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    this.logger.info('ServiceBus starting...')
    this.internalState = BusState.Started
    setTimeout(async () => this.applicationLoop(), 0)
  }

  async stop (): Promise<void> {
    this.internalState = BusState.Stopping
    this.logger.info('ServiceBus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }

    this.internalState = BusState.Stopped
    this.logger.info('ServiceBus stopped')
  }

  get state (): BusState {
    return this.internalState
  }

  on (action: HookAction, callback: HookCallback): void {
    this.busHooks.on(action, callback)
  }

  off (action: HookAction, callback: HookCallback): void {
    this.busHooks.off(action, callback)
  }

  private async applicationLoop (): Promise<void> {
    this.runningWorkerCount++
    while (this.internalState === BusState.Started) {
      await this.handleNextMessage()
    }
    this.runningWorkerCount--
  }

  private async handleNextMessage (): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()

      if (message) {
        this.logger.debug('Message read from transport', { message })

        try {
          await this.dispatchMessageToHandlers(message)
          this.logger.debug('Message dispatched to all handlers', { message })
          await this.transport.deleteMessage(message)
        } catch (error) {
          const serializedError = serializeError(error)
          this.logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializedError }
          )
          await Promise.all(this.busHooks.error.map(callback => callback(
            message.domainMessage as Message,
            message.attributes,
            serializedError
          )))
          await this.transport.returnMessage(message)
          return false
        }
        return true
      }
    } catch (error) {
      this.logger.error('Failed to receive message from transport', { error: serializeError(error) })
    }
    return false
  }

  private async dispatchMessageToHandlers (
    rawMessage: TransportMessage<MessageType>
  ): Promise<void> {
    const handlers = this.handlerRegistry.get(rawMessage.domainMessage)
    if (handlers.length === 0) {
      this.logger.warn(
        `No handlers registered for message. Message will be discarded`,
        { messageType: rawMessage.domainMessage }
      )
      return
    }

    const handlersToInvoke = handlers.map(handler => dispatchMessageToHandler(
      rawMessage,
      handler
    ))

    await Promise.all(handlersToInvoke)
  }

  private prepareTransportOptions (clientOptions: MessageAttributes): MessageAttributes {
    const result: MessageAttributes = {
      correlationId: clientOptions.correlationId || this.messageHandlingContext.correlationId,
      attributes: clientOptions.attributes,
      stickyAttributes: {
        ...clientOptions.stickyAttributes,
        ...this.messageHandlingContext.stickyAttributes
      }
    }

    return result
  }
}

async function dispatchMessageToHandler (
  rawMessage: TransportMessage<MessageType>,
  handlerRegistration: HandlerRegistration<MessageType>
): Promise<void> {
  const container = handlerRegistration.defaultContainer
  const childContainer = container.createChild()

  childContainer
    .bind<TransportMessage<MessageType>>(BUS_INTERNAL_SYMBOLS.RawMessage)
    .toConstantValue(rawMessage)

  childContainer
    .bind<MessageAttributes>(BUS_SYMBOLS.MessageHandlingContext)
    .toConstantValue(rawMessage.attributes)

  const sessionScopeBinder = container.get<SessionScopeBinder>(BUS_INTERNAL_SYMBOLS.SessionScopeBinder)
  // tslint:disable-next-line:no-unsafe-any
  sessionScopeBinder(childContainer.bind.bind(childContainer))

  const handler = handlerRegistration.resolveHandler(childContainer)
  return handler.handle(rawMessage.domainMessage, rawMessage.attributes)
}
