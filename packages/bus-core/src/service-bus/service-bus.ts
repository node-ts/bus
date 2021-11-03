import { injectable, inject, optional } from 'inversify'
import autobind from 'autobind-decorator'
import { Bus, BusState } from './bus'
import { BUS_SYMBOLS, BUS_INTERNAL_SYMBOLS } from '../bus-symbols'
import { Transport, TransportMessage } from '../transport'
import { Event, Command, MessageAttributes, Message } from '@node-ts/bus-messages'
import { Logger, LOGGER_SYMBOLS } from '@node-ts/logger-core'
import { Middleware, MiddlewareDispatcher, Next, sleep } from '../util'
import { HandlerRegistry, HandlerRegistration } from '../handler'
import * as serializeError from 'serialize-error'
import { SessionScopeBinder } from '../bus-module'
import { MessageType } from '../handler/handler'
import { BusHooks } from './bus-hooks'
import { FailMessageOutsideHandlingContext } from '../error'
import { BusConfiguration } from './bus-configuration'

@injectable()
@autobind
export class ServiceBus implements Bus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private useBeforeMiddlewareDispatcher: MiddlewareDispatcher<TransportMessage<MessageType>>

  constructor (
    @inject(BUS_SYMBOLS.Transport) private readonly transport: Transport<{}>,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.HandlerRegistry) private readonly handlerRegistry: HandlerRegistry,
    @inject(BUS_SYMBOLS.MessageHandlingContext) private readonly messageHandlingContext: MessageAttributes,
    @inject(BUS_INTERNAL_SYMBOLS.BusHooks) private readonly busHooks: BusHooks,
    @inject(BUS_SYMBOLS.BusConfiguration) private readonly busConfiguration: BusConfiguration,
    @optional() @inject(BUS_INTERNAL_SYMBOLS.RawMessage) private readonly rawMessage: TransportMessage<unknown>

  ) {
    this.useBeforeMiddlewareDispatcher = new MiddlewareDispatcher<TransportMessage<MessageType>>()
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

  useBeforeHandleNextMessage<TransportMessageType = MessageType>(useBeforeHandleNextMessageMiddleware: Middleware<TransportMessage<TransportMessageType>>) {
    if (this.internalState !== BusState.Stopped) {
      throw new Error('ServiceBus must be stopped to add useBforeHandleNextMessageMiddlewares')
    }
    this.useBeforeMiddlewareDispatcher.use(useBeforeHandleNextMessageMiddleware)
  }

  async start (): Promise<void> {
    if (this.internalState !== BusState.Stopped) {
      throw new Error('ServiceBus must be stopped before it can be started')
    }
    this.useBeforeMiddlewareDispatcher.use(this.handleNextMessagePolled)
    this.internalState = BusState.Starting
    this.logger.info('ServiceBus starting...', { concurrency: this.busConfiguration.concurrency })
    new Array(this.busConfiguration.concurrency)
      .fill(undefined)
      .forEach(() => setTimeout(async () => this.applicationLoop(), 0))
    this.internalState = BusState.Started
  }

  async stop (): Promise<void> {
    this.internalState = BusState.Stopping
    this.logger.info('ServiceBus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }


    this.internalState = BusState.Stopped
    this.logger.info('ServiceBus stopped')
    // remove our middleware from the end of the array
    this.useBeforeMiddlewareDispatcher.middlewares.pop()
  }

  get state (): BusState {
    return this.internalState
  }

  get runningParallelWorkerCount (): number {
    return this.runningWorkerCount
  }

  // tslint:disable-next-line:member-ordering
  on = this.busHooks.on.bind(this.busHooks)

  // tslint:disable-next-line:member-ordering
  off = this.busHooks.off.bind(this.busHooks)

  private async applicationLoop (): Promise<void> {
    this.runningWorkerCount++
    this.logger.debug('Worker started', { runningParallelWorkerCount: this.runningParallelWorkerCount })
    while (this.internalState === BusState.Started) {
      await this.handleNextMessage()
    }
    this.runningWorkerCount--
    this.logger.debug('Worker stopped', { runningParallelWorkerCount: this.runningParallelWorkerCount })
  }

  private async handleNextMessage (): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()

      if (message) {
        this.logger.debug('Message read from transport', { message })
        // docs to look at:
        // https://muniftanjim.dev/blog/basic-middleware-pattern-in-javascript/
        // https://evertpot.com/generic-middleware/
        // wondering if we can create a single middleware that does our first xray call - then awaits next() (so any other middlewares run) then does our second middleware.
        // we would then have this bus expose a beforeHandleNextMessage middleware which would call next,
        // and our own code would on start add itself to the middlewares to run that calls the anon function - either in applicationLoop or in start


        // first middleware call
        // wrap everything in try below as some sort of anon function. Our middleware can be written to call our code, then call anon function, then call our second bit of code.
        // look at koa and express to see how they implement 'middlewares'
        try {
          await this.useBeforeMiddlewareDispatcher.dispatch(message)
        } catch (error) {
          this.logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializeError(error) }
          )
          await Promise.all(this.busHooks.error.map(callback => callback(
            message.domainMessage as Message,
            (error as Error),
            message.attributes,
            message
          )))
          // second middleware call (might not be required)
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
  /**
   * The final middleware that runs, after all the useBeforeHandleNextMessage middlewares have completed
   * It dispatches a message that has been polled from the queue
   * and deletes the message from the transport
   */
  handleNextMessagePolled: Middleware<TransportMessage<MessageType>> = async (message: TransportMessage<MessageType>, next: Next): Promise<void> => {
    await this.dispatchMessageToHandlers(message)
    this.logger.debug('Message dispatched to all handlers', { message })
    await this.transport.deleteMessage(message)
    return next()
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
