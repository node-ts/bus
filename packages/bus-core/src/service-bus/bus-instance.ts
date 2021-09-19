import { Transport, TransportMessage } from '../transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { sleep, ClassConstructor, TypedEmitter} from '../util'
import { ClassHandler, FunctionHandler, Handler, handlerRegistry, isClassHandler } from '../handler'
import { serializeError } from 'serialize-error'
import { BusState } from './bus'
import { messageHandlingContext } from '../message-handling-context'
import { ClassHandlerNotResolved, FailMessageOutsideHandlingContext } from '../error'
import { ContainerAdapter } from '../container'
import { getLogger } from '../logger'
import { WorkflowRegistry } from '../workflow/registry/workflow-registry'
import { v4 as generateUuid } from 'uuid'

const EMPTY_QUEUE_SLEEP_MS = 500

const logger = () => getLogger('@node-ts/bus-core:service-bus')

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
    handlers: Handler[]
  }>()
  readonly afterDispatch = new TypedEmitter<{
    message: Message,
    attributes: MessageAttributes
  }>()

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0

  constructor (
    private readonly transport: Transport<{}>,
    private readonly concurrency: number,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly container: ContainerAdapter | undefined
  ) {
  }

  async publish<TEvent extends Event> (
    event: TEvent,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    logger().debug('Publishing event', { event, messageOptions })
    const attributes = this.prepareTransportOptions(messageOptions)
    this.beforePublish.emit({ event, attributes })
    return this.transport.publish(event, attributes)
  }

  async send<TCommand extends Command> (
    command: TCommand,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    logger().debug('Sending command', { command, messageOptions })
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
    logger().debug('Failing message', { message })
    return this.transport.fail(message)
  }

  async start (): Promise<void> {
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new Error('Bus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    logger().info('Bus starting...')
    messageHandlingContext.enable()

    this.internalState = BusState.Started
    for (var i = 0; i < this.concurrency; i++) {
      setTimeout(async () => this.applicationLoop(), 0)
    }

    logger().info(`Bus started with concurrency ${this.concurrency}`)
  }

  async stop (): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new Error('Bus must be started before it can be stopped')
    }
    this.internalState = BusState.Stopping
    logger().info('Bus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }

    this.internalState = BusState.Stopped
    logger().info('Bus stopped')
  }

  /**
   * Stops and disposes all resources allocated to the bus, as well as removing
   * all handler registrations.
   */
  async dispose (): Promise<void> {
    if (![BusState.Stopped, BusState.Stopped].includes(this.state)) {
      await this.stop()
    }
    if (this.transport.dispose) {
      await this.transport.dispose()
    }
    await this.workflowRegistry.dispose()
    handlerRegistry.reset()
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
        logger().debug('Message read from transport', { message })
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
          logger().warn(
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
      logger().error('Failed to receive message from transport', { error: serializeError(error) })
    }
    return false
  }

  private async dispatchMessageToHandlers (message: Message, messageAttributes: MessageAttributes): Promise<void> {
    const handlers = handlerRegistry.get(message)
    if (handlers.length === 0) {
      logger().error(`No handlers registered for message. Message will be discarded`, { messageName: message.$name })
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
    logger().debug('Message dispatched to all handlers', { message, numHandlers: handlersToInvoke.length })
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

    logger().debug('Prepared transport options', { messageAttributes })

    return messageAttributes
  }

  async dispatchMessageToHandler (
    message: Message,
    attributes: MessageAttributes,
    handler: Handler<Message>
  ): Promise<void> {
    if (isClassHandler(handler)) {
      const classHandler = handler as ClassConstructor<ClassHandler<Message>>

      let handlerInstance: ClassHandler<Message> | undefined
      try {
        handlerInstance = this.container!.get(classHandler)
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