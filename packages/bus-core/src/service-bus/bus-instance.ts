import { Transport, TransportMessage } from '../transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { sleep, ClassConstructor, TypedEmitter, CoreDependencies} from '../util'
import { ClassHandler, FunctionHandler, HandlerDefinition, isClassHandler } from '../handler'
import { serializeError } from 'serialize-error'
import { BusState } from './bus'
import { messageHandlingContext } from '../message-handling-context'
import { ClassHandlerNotResolved, FailMessageOutsideHandlingContext } from '../error'
import { v4 as generateUuid } from 'uuid'
import { WorkflowRegistry } from '../workflow/registry'
import { Logger } from '../logger'

const EMPTY_QUEUE_SLEEP_MS = 500

export class BusInstance {

  readonly beforeSend = new TypedEmitter<{ command: Command, attributes: MessageAttributes }>()
  readonly beforePublish = new TypedEmitter<{ event: Event, attributes: MessageAttributes }>()
  readonly onError = new TypedEmitter<{
    message: Message,
    error: Error,
    attributes?: MessageAttributes,
    rawMessage?: TransportMessage<unknown>
  }>()
  readonly afterReceive = new TypedEmitter<TransportMessage<unknown>>()
  readonly beforeDispatch = new TypedEmitter<{
    message: Message,
    attributes: MessageAttributes,
    handlers: HandlerDefinition[]
  }>()
  readonly afterDispatch = new TypedEmitter<{
    message: Message,
    attributes: MessageAttributes
  }>()

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private logger: Logger

  constructor (
    private readonly transport: Transport<{}>,
    private readonly concurrency: number,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly coreDependencies: CoreDependencies
  ) {
    this.logger = coreDependencies.loggerFactory('@node-ts/bus-core:service-bus')

  }

  async publish<TEvent extends Event> (
    event: TEvent,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    this.logger.debug('Publishing event', { event, messageOptions })
    const attributes = this.prepareTransportOptions(messageOptions)
    this.beforePublish.emit({ event, attributes })
    return this.transport.publish(event, attributes)
  }

  async send<TCommand extends Command> (
    command: TCommand,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    this.logger.debug('Sending command', { command, messageOptions })
    const attributes = this.prepareTransportOptions(messageOptions)
    this.beforeSend.emit({ command, attributes })
    return this.transport.send(command, attributes)
  }

  async fail (): Promise<void> {
    const context = messageHandlingContext.get()
    if (!context) {
      throw new FailMessageOutsideHandlingContext()
    }
    const message = context.message
    this.logger.debug('Failing message', { message })
    return this.transport.fail(message)
  }

  async start (): Promise<void> {
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new Error('Bus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    this.logger.info('Bus starting...')
    messageHandlingContext.enable()

    this.internalState = BusState.Started
    for (var i = 0; i < this.concurrency; i++) {
      setTimeout(async () => this.applicationLoop(), 0)
    }

    this.logger.info(`Bus started with concurrency ${this.concurrency}`)
  }

  async stop (): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new Error('Bus must be started before it can be stopped')
    }
    this.internalState = BusState.Stopping
    this.logger.info('Bus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }

    this.internalState = BusState.Stopped
    this.logger.info('Bus stopped')
  }

  /**
   * Stops and disposes all resources allocated to the bus, as well as removing
   * all handler registrations.
   *
   * The bus instance can not be used after this has been called.
   */
  async dispose (): Promise<void> {
    this.logger.info('Disposing bus instance...')
    if (![BusState.Stopped, BusState.Stopped].includes(this.state)) {
      await this.stop()
    }
    if (this.transport.dispose) {
      await this.transport.dispose()
    }
    await this.workflowRegistry.dispose()
    this.coreDependencies.handlerRegistry.reset()
    this.logger.info('Bus disposed')
  }

  get state (): BusState {
    return this.internalState
  }

  private async applicationLoop (): Promise<void> {
    this.runningWorkerCount++
    while (this.internalState === BusState.Started) {
      const messageHandled = await this.handleNextMessage()

      // Avoids locking up CPU when there's no messages to be processed
      if (!messageHandled) {
        await sleep(EMPTY_QUEUE_SLEEP_MS)
      }
    }
    this.runningWorkerCount--
  }

  private async handleNextMessage (): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()

      if (message) {
        this.logger.debug('Message read from transport', { message })
        this.afterReceive.emit(message)

        try {
          messageHandlingContext.set(message)

          await this.dispatchMessageToHandlers(message.domainMessage, message.attributes)
          await this.transport.deleteMessage(message)

          this.afterDispatch.emit({
            message: message.domainMessage,
            attributes: message.attributes
          })
        } catch (error) {
          this.logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializeError(error) }
          )
          this.onError.emit({
            message: message.domainMessage,
            error,
            attributes: message.attributes,
            rawMessage: message
          })
          await this.transport.returnMessage(message)
          return false
        } finally {
          messageHandlingContext.destroy()
        }
        return true
      }
    } catch (error) {
      this.logger.error('Failed to handle and dispatch message from transport', { error: serializeError(error) })
    }
    return false
  }

  private async dispatchMessageToHandlers (message: Message, messageAttributes: MessageAttributes): Promise<void> {
    const handlers = this.coreDependencies.handlerRegistry.get(this.coreDependencies.loggerFactory, message)
    if (handlers.length === 0) {
      this.logger.error(`No handlers registered for message. Message will be discarded`, { messageName: message.$name })
      return
    }

    const handlersToInvoke = handlers.map(handler => this.dispatchMessageToHandler(
      message,
      messageAttributes,
      handler
    ))

    this.beforeDispatch.emit({
      message,
      attributes: messageAttributes,
      handlers
    })

    await Promise.all(handlersToInvoke)
    this.logger.debug('Message dispatched to all handlers', { message, numHandlers: handlersToInvoke.length })
  }

  private prepareTransportOptions (clientOptions: Partial<MessageAttributes>): MessageAttributes {
    const handlingContext = messageHandlingContext.get()

    const messageAttributes: MessageAttributes = {
      // The optional operator? decided not to work here
      correlationId: clientOptions.correlationId
        || (handlingContext ? handlingContext.message.attributes.correlationId : undefined)
        || generateUuid(),
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...(handlingContext ? handlingContext.message.attributes.stickyAttributes : {}),
        ...clientOptions.stickyAttributes
      }
    }

    this.logger.debug('Prepared transport options', { messageAttributes })

    return messageAttributes
  }

  async dispatchMessageToHandler (
    message: Message,
    attributes: MessageAttributes,
    handler: HandlerDefinition<Message>
  ): Promise<void> {
    if (isClassHandler(handler)) {
      const classHandler = handler as ClassConstructor<ClassHandler<Message>>

      let handlerInstance: ClassHandler<Message> | undefined
      try {
        handlerInstance = this.coreDependencies.container!.get(classHandler)
        if (!handlerInstance) {
          throw new Error('Container failed to resolve an instance.')
        }
      } catch (e) {
        throw new ClassHandlerNotResolved(e.message)
      }

      return handlerInstance.handle(message, attributes)
    } else {
      const fnHandler = handler as FunctionHandler<Message>
      return fnHandler(
        message,
        attributes
      )
    }
  }
}
