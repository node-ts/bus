import { Transport, TransportMessage } from '../transport'
import {
  Event,
  Command,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import {
  sleep,
  ClassConstructor,
  TypedEmitter,
  CoreDependencies,
  MiddlewareDispatcher,
  Middleware,
  Next
} from '../util'
import {
  Handler,
  FunctionHandler,
  HandlerDefinition,
  isClassHandler,
  HandlerDispatchRejected,
  HandlerRegistry
} from '../handler'
import { serializeError } from 'serialize-error'
import { BusState } from './bus-state'
import { messageHandlingContext } from '../message-handling-context'
import {
  ClassHandlerNotResolved,
  FailMessageOutsideHandlingContext
} from '../error'
import { v4 as generateUuid } from 'uuid'
import { WorkflowRegistry } from '../workflow/registry'
import { Logger } from '../logger'
import { InvalidBusState, InvalidOperation } from './error'
import { ContainerAdapter } from 'src/container'

const EMPTY_QUEUE_SLEEP_MS = 500

export class BusInstance<TTransportMessage = {}> {
  readonly beforeSend = new TypedEmitter<{
    command: Command
    attributes: MessageAttributes
  }>()
  readonly beforePublish = new TypedEmitter<{
    event: Event
    attributes: MessageAttributes
  }>()
  readonly onError = new TypedEmitter<{
    message: Message
    error: Error
    attributes?: MessageAttributes
    rawMessage?: TransportMessage<TTransportMessage>
  }>()
  readonly afterReceive = new TypedEmitter<
    TransportMessage<TTransportMessage>
  >()
  readonly beforeDispatch = new TypedEmitter<{
    message: Message
    attributes: MessageAttributes
    handlers: HandlerDefinition[]
  }>()
  readonly afterDispatch = new TypedEmitter<{
    message: Message
    attributes: MessageAttributes
  }>()

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private logger: Logger
  private isInitialized = false

  constructor(
    private readonly transport: Transport<TTransportMessage>,
    private readonly concurrency: number,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly coreDependencies: CoreDependencies,
    private readonly messageReadMiddleware: MiddlewareDispatcher<
      TransportMessage<unknown>
    >,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly container: ContainerAdapter | undefined,
    private readonly sendOnly: boolean
  ) {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:service-bus'
    )
    this.messageReadMiddleware.useFinal(this.handleNextMessagePolled)
  }

  /**
   * Initializes the bus with the provided configuration. This must be called before `.start()`
   *
   * @throws InvalidOperation if the bus has already been initialized
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing bus')

    if (this.isInitialized) {
      throw new InvalidOperation('Bus has already been initialized')
    }

    if (!this.sendOnly) {
      await this.workflowRegistry.initialize(
        this.handlerRegistry,
        this.container
      )
    }

    if (this.transport.connect) {
      await this.transport.connect({
        concurrency: this.concurrency
      })
    }
    if (!this.sendOnly && this.transport.initialize) {
      await this.transport.initialize({
        handlerRegistry: this.handlerRegistry,
        sendOnly: this.sendOnly
      })
    }

    this.isInitialized = true
    this.logger.debug('Bus initialized', {
      sendOnly: this.sendOnly,
      registeredMessages: this.handlerRegistry.getMessageNames()
    })
  }

  /**
   * Publishes an event to the transport
   * @param event An event to publish
   * @param messageAttributes A set of attributes to attach to the outgoing message when published
   */
  async publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes: Partial<MessageAttributes> = {}
  ): Promise<void> {
    this.logger.debug('Publishing event', { event, messageAttributes })
    const attributes = this.prepareTransportOptions(messageAttributes)
    this.beforePublish.emit({ event, attributes })
    return this.transport.publish(event, attributes)
  }

  /**
   * Sends a command to the transport
   * @param command A command to send
   * @param messageAttributes A set of attributes to attach to the outgoing messsage when sent
   */
  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes: Partial<MessageAttributes> = {}
  ): Promise<void> {
    this.logger.debug('Sending command', { command, messageAttributes })
    const attributes = this.prepareTransportOptions(messageAttributes)
    this.beforeSend.emit({ command, attributes })
    return this.transport.send(command, attributes)
  }

  /**
   * Instructs the bus that the current message being handled cannot be processed even with
   * retries and instead should immediately be routed to the dead letter queue
   * @throws FailMessageOutsideHandlingContext if called outside a message handling context
   */
  async fail(): Promise<void> {
    const context = messageHandlingContext.get()
    if (!context) {
      throw new FailMessageOutsideHandlingContext()
    }
    const message = context.message
    this.logger.debug('Failing message', { message })
    return this.transport.fail(message)
  }

  /**
   * Instructs the bus to start reading messages from the underlying service queue
   * and dispatching to message handlers.
   *
   * @throws InvalidOperation if the bus is configured to be send-only
   * @throws InvalidOperation if the bus has not been initialized
   * @throws InvalidBusState if the bus is already started or in a starting state
   */
  async start(): Promise<void> {
    if (this.sendOnly) {
      throw new InvalidOperation('Cannot start a send-only bus')
    }
    if (!this.isInitialized) {
      throw new InvalidOperation('Bus must be initialized before starting')
    }
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new InvalidBusState(
        'Bus must be stopped before it can be started',
        this.state,
        [BusState.Stopped, BusState.Stopping]
      )
    }
    this.internalState = BusState.Starting
    this.logger.info('Bus starting...')
    messageHandlingContext.enable()

    if (this.transport.start) {
      await this.transport.start()
    }

    this.internalState = BusState.Started
    for (var i = 0; i < this.concurrency; i++) {
      setTimeout(async () => this.applicationLoop(), 0)
    }

    this.logger.info(`Bus started with concurrency ${this.concurrency}`)
  }

  /**
   * Stops a bus that has been started by `.start()`. This will wait for all running workers to complete
   * their current message handling contexts before returning.
   *
   * @throws InvalidBusState if the bus is already stopped or stopping
   */
  async stop(): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new InvalidBusState(
        'Bus must be started before it can be stopped',
        this.state,
        [BusState.Started, BusState.Started]
      )
    }
    this.internalState = BusState.Stopping
    this.logger.info('Bus stopping...')
    if (this.transport.stop) {
      await this.transport.stop()
    }

    while (this.runningWorkerCount > 0) {
      await sleep(10)
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
  async dispose(): Promise<void> {
    this.logger.info('Disposing bus instance...')
    if (![BusState.Stopped, BusState.Stopped].includes(this.state)) {
      await this.stop()
    }
    if (this.transport.disconnect) {
      await this.transport.disconnect()
    }
    if (this.transport.dispose) {
      await this.transport.dispose()
    }
    await this.workflowRegistry.dispose()
    this.coreDependencies.handlerRegistry.reset()
    this.logger.info('Bus instance disposed')
  }

  /**
   * Gets the current state of a message-handling bus
   */
  get state(): BusState {
    return this.internalState
  }

  private async applicationLoop(): Promise<void> {
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

  private async handleNextMessage(): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()

      if (message) {
        this.logger.debug('Message read from transport', { message })
        this.afterReceive.emit(message)

        try {
          messageHandlingContext.set(message)

          await this.messageReadMiddleware.dispatch(message)

          this.afterDispatch.emit({
            message: message.domainMessage,
            attributes: message.attributes
          })
        } catch (error) {
          this.logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { busMessage: message, error: serializeError(error) }
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
      this.logger.error(
        'Failed to handle and dispatch message from transport',
        { error: serializeError(error) }
      )
    }
    return false
  }

  private async dispatchMessageToHandlers(
    message: Message,
    messageAttributes: MessageAttributes
  ): Promise<void> {
    const handlers = this.coreDependencies.handlerRegistry.get(
      this.coreDependencies.loggerFactory,
      message
    )
    if (handlers.length === 0) {
      this.logger.error(
        `No handlers registered for message. Message will be discarded`,
        { messageName: message.$name }
      )
      return
    }

    const handlersToInvoke = handlers.map(handler =>
      this.dispatchMessageToHandler(message, messageAttributes, handler)
    )

    this.beforeDispatch.emit({
      message,
      attributes: messageAttributes,
      handlers
    })

    const handlerResults = await Promise.allSettled(handlersToInvoke)
    const failedHandlers = handlerResults.filter(r => r.status === 'rejected')
    if (failedHandlers.length) {
      const reasons = (failedHandlers as PromiseRejectedResult[]).map(
        h => h.reason
      )
      throw new HandlerDispatchRejected(reasons)
    }

    this.logger.debug('Message dispatched to all handlers', {
      message,
      numHandlers: handlersToInvoke.length
    })
  }

  private prepareTransportOptions(
    clientOptions: Partial<MessageAttributes>
  ): MessageAttributes {
    const handlingContext = messageHandlingContext.get()

    const messageAttributes: MessageAttributes = {
      // The optional operator? decided not to work here
      correlationId:
        clientOptions.correlationId ||
        (handlingContext
          ? handlingContext.message.attributes.correlationId
          : undefined) ||
        generateUuid(),
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...(handlingContext
          ? handlingContext.message.attributes.stickyAttributes
          : {}),
        ...clientOptions.stickyAttributes
      }
    }

    this.logger.debug('Prepared transport options', { messageAttributes })

    return messageAttributes
  }

  async dispatchMessageToHandler(
    message: Message,
    attributes: MessageAttributes,
    handler: HandlerDefinition<Message>
  ): Promise<void> {
    if (isClassHandler(handler)) {
      const classHandler = handler as ClassConstructor<Handler<Message>>

      let handlerInstance: Handler<Message> | undefined
      try {
        const handlerInstanceFromContainer =
          this.coreDependencies.container!.get(classHandler, {
            message,
            messageAttributes: attributes
          })
        if (handlerInstanceFromContainer instanceof Promise) {
          handlerInstance = await handlerInstanceFromContainer
        } else {
          handlerInstance = handlerInstanceFromContainer
        }
        if (!handlerInstance) {
          throw new Error('Container failed to resolve an instance.')
        }
      } catch (e) {
        throw new ClassHandlerNotResolved(e.message)
      }

      return handlerInstance.handle(message, attributes)
    } else {
      const fnHandler = handler as FunctionHandler<Message>
      return fnHandler(message, attributes)
    }
  }

  /**
   * The final middleware that runs, after all the useBeforeHandleNextMessage middlewares have completed
   * It dispatches a message that has been polled from the queue
   * and deletes the message from the transport
   */
  private handleNextMessagePolled: Middleware<
    TransportMessage<TTransportMessage>
  > = async (
    message: TransportMessage<TTransportMessage>,
    next: Next
  ): Promise<void> => {
    await this.dispatchMessageToHandlers(
      message.domainMessage,
      message.attributes
    )
    await this.transport.deleteMessage(message)
    return next()
  }
}
