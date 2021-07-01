import { Transport } from '../transport'
import { Event, Command, Message, MessageAttributes } from '@node-ts/bus-messages'
import { sleep, ClassConstructor} from '../util'
import { ClassHandler, FunctionHandler, Handler, handlerRegistry } from '../handler'
import { serializeError } from 'serialize-error'
import { BusState } from './bus'
import { messageHandlingContext } from './message-handling-context'
import * as asyncHooks from 'async_hooks'
import { BusHooks } from './bus-hooks'
import { ClassHandlerNotResolved, ContainerNotRegistered, FailMessageOutsideHandlingContext } from '../error'
import { getContainer } from '../container'
import { getLogger } from '../logger'
import { workflowRegistry } from '../workflow/registry/workflow-registry'

const EMPTY_QUEUE_SLEEP_MS = 500

const logger = getLogger('@node-ts/bus-core:service-bus')

export class ServiceBus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private busHooks = new BusHooks()

  constructor (
    private readonly transport: Transport<{}>,
    private readonly concurrency: number
  ) {
  }

  async publish<TEvent extends Event> (
    event: TEvent,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    logger.debug('Publishing event', { event })
    const transportOptions = this.prepareTransportOptions(messageOptions)
    await Promise.all(this.busHooks.publish.map(callback => callback(event, transportOptions)))
    return this.transport.publish(event, transportOptions)
  }

  async send<TCommand extends Command> (
    command: TCommand,
    messageOptions: Partial<MessageAttributes> = {}
  ): Promise<void> {
    logger.debug('Sending command', { command })
    const transportOptions = this.prepareTransportOptions(messageOptions)
    await Promise.all(this.busHooks.send.map(callback => callback(command, transportOptions)))
    return this.transport.send(command, transportOptions)
  }

  async fail (): Promise<void> {
    const context = messageHandlingContext.get()
    if (!context) {
      throw new FailMessageOutsideHandlingContext()
    }
    const message = context.message
    logger.debug('failing message', { message })
    return this.transport.fail(message)
  }

  async start (): Promise<void> {
    const startedStates = [BusState.Started, BusState.Starting]
    if (startedStates.includes(this.state)) {
      throw new Error('ServiceBus must be stopped before it can be started')
    }
    this.internalState = BusState.Starting
    logger.info('ServiceBus starting...')
    messageHandlingContext.enable()

    this.internalState = BusState.Started
    for (var i = 0; i < this.concurrency; i++) {
      setTimeout(async () => this.applicationLoop(), 0)
    }

    logger.info(`ServiceBus started with concurrency ${this.concurrency}`)
  }

  async stop (): Promise<void> {
    const stoppedStates = [BusState.Stopped, BusState.Stopping]
    if (stoppedStates.includes(this.state)) {
      throw new Error('Bus must be started before it can be stopped')
    }
    this.internalState = BusState.Stopping
    logger.info('ServiceBus stopping...')

    while (this.runningWorkerCount > 0) {
      await sleep(100)
    }

    this.internalState = BusState.Stopped
    logger.info('ServiceBus stopped')
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
    await workflowRegistry.dispose()
    handlerRegistry.reset()
  }

  get state (): BusState {
    return this.internalState
  }

  on = this.busHooks.on.bind(this.busHooks)

  off = this.busHooks.off.bind(this.busHooks)

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
        logger.debug('Message read from transport', { message })

        const asyncId = asyncHooks.executionAsyncId()
        try {
          messageHandlingContext.set(asyncId, message)

          await this.dispatchMessageToHandlers(message.domainMessage, message.attributes)
          await this.transport.deleteMessage(message)
        } catch (error) {
          logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializeError(error) }
          )
          await Promise.all(this.busHooks.error.map(callback => callback(
            message.domainMessage as Message,
            (error as Error),
            message.attributes,
            message
          )))
          await this.transport.returnMessage(message)
          return false
        } finally {
          messageHandlingContext.destroy(asyncId)
        }
        return true
      }
    } catch (error) {
      logger.error('Failed to receive message from transport', { error: serializeError(error) })
    }
    return false
  }

  private async dispatchMessageToHandlers (message: Message, context: MessageAttributes): Promise<void> {
    const handlers = handlerRegistry.get(message)
    if (handlers.length === 0) {
      logger.error(`No handlers registered for message. Message will be discarded`, { messageName: message.$name })
      return
    }

    const handlersToInvoke = handlers.map(handler => this.dispatchMessageToHandler(
      message,
      context,
      handler
    ))

    await Promise.all(handlersToInvoke)
    logger.debug('Message dispatched to all handlers', { message, numHandlers: handlersToInvoke.length })
  }

  private prepareTransportOptions (clientOptions: Partial<MessageAttributes>): MessageAttributes {
    const handlingContext = messageHandlingContext.get()

    const result: MessageAttributes = {
      // The optional operator? decided not to work here
      correlationId: (handlingContext ? handlingContext.message.attributes.correlationId : undefined) || clientOptions.correlationId,
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...(handlingContext ? handlingContext.message.attributes.stickyAttributes : {}),
        ...clientOptions.stickyAttributes
      }
    }

    return result
  }

  async dispatchMessageToHandler (
    message: Message,
    attributes: MessageAttributes,
    handler: Handler<Message>
  ): Promise<void> {
    // A naive but best guess effort into if a handler is class based and should be resolved from a container
    const isClassHandler = handler.prototype?.handle && handler.prototype?.constructor?.name
    if (isClassHandler) {
      const classHandler = handler as ClassConstructor<ClassHandler<Message>>

      const container = getContainer()
      if (!container) {
        throw new ContainerNotRegistered(message, classHandler.constructor.name)
      }
      let handlerInstance: ClassHandler<Message> | undefined
      try {
        handlerInstance = container.get(classHandler)
        if (!handlerInstance) {
          throw new Error('Container failed to resolve an instance.')
        }
      } catch (e) {
        throw new ClassHandlerNotResolved(e.message)
      }

      return handlerInstance.handle({ message, attributes })
    } else {
      const fnHandler = handler as FunctionHandler<Message>
      return fnHandler({
        message,
        attributes
      })
    }
  }

}
