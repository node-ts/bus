import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { serializeError } from 'serialize-error'
import throat from 'throat'
import { ContainerAdapter } from '../container'
import {
  ClassHandlerNotResolved,
  FailMessageOutsideHandlingContext,
  ReturnMessageOutsideHandlingContext
} from '../error'
import {
  FunctionHandler,
  Handler,
  HandlerDefinition,
  HandlerDispatchRejected,
  HandlerRegistry,
  isClassHandler
} from '../handler'
import { Logger } from '../logger'
import { messageHandlingContext } from '../message-handling-context'
import { messageLifecycleContext } from '../message-lifecycle-context'
import {
  ReceivedMessageFailure,
  ReceivedMessageReturnedToQueue,
  Receiver
} from '../receiver'
import { MessageTypesMissing } from '../serialization'
import { Transport, TransportMessage } from '../transport'
import {
  ClassConstructor,
  CoreDependencies,
  Middleware,
  MiddlewareDispatcher,
  Next,
  sleep,
  TypedEmitter
} from '../util'
import { WorkflowRegistry } from '../workflow/registry'
import { BusState } from './bus-state'
import { InvalidBusState, InvalidOperation } from './error'

const EMPTY_QUEUE_SLEEP_MS = 500

interface InterruptSignalListener {
  signal: NodeJS.Signals
  listener: () => void
}

enum OutboxState {
  /**
   * The handler is running, so outgoing messages are buffered
   */
  Open = 'open',
  /**
   * The handler resolved and its buffered messages were dispatched
   */
  Flushed = 'flushed',
  /**
   * The handler failed and its buffered messages were dropped
   */
  Discarded = 'discarded'
}

interface OutboxedMessage {
  command?: Command
  event?: Event
  attributes: MessageAttributes
}

interface Outbox {
  state: OutboxState
  messages: OutboxedMessage[]
}

export interface BeforeSend {
  command: Command
  attributes: MessageAttributes
}

export interface BeforePublish {
  event: Event
  attributes: MessageAttributes
}

export interface AfterSend {
  command: Command
  attributes?: MessageAttributes
}

export interface AfterPublish {
  event: Event
  attributes?: MessageAttributes
}

export interface OnError<TTransportMessage> {
  message: Message
  error: Error
  attributes?: MessageAttributes
  rawMessage?: TransportMessage<TTransportMessage>
}

export interface AfterReceive<TTransportMessage> {
  message: TransportMessage<TTransportMessage>
}

export interface BeforeDispatch {
  message: Message
  attributes: MessageAttributes
  handlers: HandlerDefinition[]
}

export interface AfterDispatch {
  message: Message
  attributes: MessageAttributes
}
export class BusInstance<TTransportMessage = {}> {
  /**
   * Emitted before a command is sent to the transport
   */
  readonly beforeSend = new TypedEmitter<BeforeSend>(
    this.logListenerRejected('beforeSend')
  )
  /**
   * Emitted before an event is published to the transport
   */
  readonly beforePublish = new TypedEmitter<BeforePublish>(
    this.logListenerRejected('beforePublish')
  )
  /**
   * Emitted after a command has been sent to the transport
   */
  readonly afterSend = new TypedEmitter<AfterSend>(
    this.logListenerRejected('afterSend')
  )
  /**
   * Emitted after an event has been published to the transport
   */
  readonly afterPublish = new TypedEmitter<AfterPublish>(
    this.logListenerRejected('afterPublish')
  )
  /**
   * Emitted when an error occurs during message handling
   */
  readonly onError = new TypedEmitter<OnError<TTransportMessage>>(
    this.logListenerRejected('onError')
  )
  /**
   * Emitted immediately after a message has been received from the transport
   */
  readonly afterReceive = new TypedEmitter<AfterReceive<TTransportMessage>>(
    this.logListenerRejected('afterReceive')
  )
  /**
   * Emitted before a message is dispatched to handlers
   */
  readonly beforeDispatch = new TypedEmitter<BeforeDispatch>(
    this.logListenerRejected('beforeDispatch')
  )
  /**
   * Emitted after a message has been dispatched and completed all handler invocations
   */
  readonly afterDispatch = new TypedEmitter<AfterDispatch>(
    this.logListenerRejected('afterDispatch')
  )

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0
  private logger: Logger
  private isInitialized = false
  private stopInProgress: Promise<void> | undefined
  private interruptSignalListeners: InterruptSignalListener[] = []
  private readonly outbox = new AsyncLocalStorage<Outbox>()

  constructor(
    private readonly transport: Transport<TTransportMessage>,
    private readonly concurrency: number,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly coreDependencies: CoreDependencies,
    private readonly messageReadMiddleware: MiddlewareDispatcher<
      TransportMessage<any>
    >,
    private readonly handlerRegistry: HandlerRegistry,
    private readonly container: ContainerAdapter | undefined,
    private readonly sendOnly: boolean,
    private readonly receiver: Receiver | undefined
  ) {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:service-bus'
    )
    this.messageReadMiddleware.useFinal(this.handleNextMessagePolled)
  }

  /**
   * Receive one or more messages to dispatch directly to handlers. This can only be called when a Receiver
   * has been configured using Bus.configure().withReceiver()
   *
   * @param message The message, or batch of messages, received by the host (e.g. a Lambda event)
   * @returns Nothing, unless the receiver implements `toReceiveResult`, in which case its result is returned
   * @throws InvalidOperation if no Receiver has been configured
   * @throws the handling error of a failed message, unless the receiver implements `toReceiveResult`
   * @throws ReceivedMessageReturnedToQueue if a handler called `returnMessage()`, unless the receiver implements
   * `toReceiveResult`, which then gets it as a failure
   * @example
   * // Receiver that reports partial batch failures
   * const response = await bus.receive<SQSBatchResponse>(event)
   */
  async receive<TReceiveResult = void>(
    message: unknown
  ): Promise<TReceiveResult> {
    if (!this.receiver) {
      throw new InvalidOperation(
        'Cannot use handler when a Receiver is not set. Use Bus.configure().withReceiver() to set a Receiver.'
      )
    }
    this.logger.info('Received messages to process')
    const messagesReceived = await this.receiver.receive(
      message,
      this.coreDependencies.messageSerializer
    )
    const messagesToDispatch = (
      Array.isArray(messagesReceived) ? messagesReceived : [messagesReceived]
    ) as TransportMessage<TTransportMessage>[]

    this.logger.debug('Parsed messages from receiver', {
      numMessages: messagesToDispatch.length
    })

    // Throttle back to concurrency, since batch sizes can be far beyond this limit.
    const throttle = throat(this.concurrency)
    const handleMessage = (message: TransportMessage<TTransportMessage>) =>
      throttle(() => this.handleReceivedMessage(message))

    if (!this.receiver.toReceiveResult) {
      await Promise.all(messagesToDispatch.map(handleMessage))
      this.logger.debug('All received messages dispatched to handlers')
      return undefined as TReceiveResult
    }

    const results = await Promise.allSettled(
      messagesToDispatch.map(handleMessage)
    )
    const failures: ReceivedMessageFailure[] = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failures.push({
          message: messagesToDispatch[index],
          error: result.reason as Error
        })
      }
    })

    this.logger.debug('All received messages dispatched to handlers', {
      numFailed: failures.length
    })
    return (await this.receiver.toReceiveResult(failures)) as TReceiveResult
  }

  /**
   * Initializes the bus with the provided configuration. This must be called before `.start()`
   *
   * @throws InvalidOperation if the bus has already been initialized
   * @throws MessageTypesMissing if message types are configured but a handled message or a workflow state has
   * no entry in them
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
      this.assertMessageTypesRegistered()
    }

    if (this.transport.connect) {
      await this.transport.connect({
        concurrency: this.concurrency
      })
    }
    if (this.transport.initialize) {
      await this.transport.initialize({
        handlerRegistry: this.handlerRegistry,
        sendOnly: this.sendOnly
      })
    }

    this.subscribeToInterruptSignals(this.coreDependencies.interruptSignals)
    this.isInitialized = true
    this.logger.debug('Bus initialized', {
      sendOnly: this.sendOnly,
      registeredMessages: this.handlerRegistry.getMessageNames()
    })
  }

  /**
   * Publishes an event to the transport.
   *
   * When called from inside a handler, the event is buffered and only published once the handler resolves, and
   * is dropped if the handler fails. Anywhere else (outside a handler, in read middleware or lifecycle listeners,
   * or after the handler has already resolved) it's published straight away. `afterPublish` is emitted once
   * the transport has published it.
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

    if (this.addToOutbox({ event, attributes })) {
      return
    }
    await this.transport.publish(event, attributes)
    this.afterPublish.emit({ event, attributes })
  }

  /**
   * Sends a command to the transport.
   *
   * When called from inside a handler, the command is buffered and only sent once the handler resolves, and
   * is dropped if the handler fails. Anywhere else (outside a handler, in read middleware or lifecycle listeners,
   * or after the handler has already resolved) it's sent straight away. `afterSend` is emitted once the
   * transport has sent it.
   * @param command A command to send
   * @param messageAttributes A set of attributes to attach to the outgoing message when sent
   */
  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes: Partial<MessageAttributes> = {}
  ): Promise<void> {
    this.logger.debug('Sending command', { command, messageAttributes })
    const attributes = this.prepareTransportOptions(messageAttributes)
    this.beforeSend.emit({ command, attributes })

    if (this.addToOutbox({ command, attributes })) {
      return
    }
    await this.transport.send(command, attributes)
    this.afterSend.emit({ command, attributes })
  }

  /**
   * Instructs the bus that the current message being handled cannot be processed even with
   * retries and instead should immediately be routed to the dead letter queue
   * @throws FailMessageOutsideHandlingContext if called outside a message handling context
   */
  async failMessage(): Promise<void> {
    const message = messageHandlingContext.get()
    if (!message) {
      throw new FailMessageOutsideHandlingContext()
    }
    this.logger.debug('Failing message', { message })
    return this.transport.fail(message)
  }

  /**
   * Instructs that the current message should be returned to the queue for retry. When the message came from a
   * Receiver, it's also reported to the receiver host as failed so the host doesn't delete it.
   * @throws ReturnMessageOutsideHandlingContext if called outside a message handling context
   */
  async returnMessage(): Promise<void> {
    const context = messageLifecycleContext.get()
    const message = messageHandlingContext.get()
    if (!context || !message) {
      throw new ReturnMessageOutsideHandlingContext()
    }
    messageLifecycleContext.set({
      ...context,
      messageReturnedToQueue: true
    })
    this.logger.debug('Returning message', { message })
    return this.transport.returnMessage(message)
  }

  /**
   * Instructs the bus to start reading messages from the underlying service queue
   * and dispatching to message handlers.
   *
   * @throws InvalidOperation if the bus is configured to be send-only
   * @throws InvalidOperation if the bus has not been initialized
   * @throws InvalidOperation if the bus has a receiver set
   * @throws InvalidBusState if the bus is already started or in a starting state
   */
  async start(): Promise<void> {
    if (this.sendOnly) {
      throw new InvalidOperation('Cannot start a send-only bus')
    }
    if (!this.isInitialized) {
      throw new InvalidOperation('Bus must be initialized before starting')
    }
    if (this.receiver) {
      throw new InvalidOperation(
        'Cannot start a bus with a Receiver. Pass incoming messages for dispatch by invoking bus.receive()'
      )
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

    if (this.transport.start) {
      await this.transport.start()
    }

    if (this.internalState !== BusState.Starting) {
      // stop() was called while the transport was starting, so don't spin up workers
      this.logger.info('Bus was stopped before it finished starting')
      return
    }

    this.internalState = BusState.Started
    for (let i = 0; i < this.concurrency; i++) {
      // Count the worker before it's scheduled so a stop() straight after start() waits for it
      this.runningWorkerCount++
      setTimeout(() => {
        // The loop handles its own errors, so this only catches a bug in the loop itself
        this.applicationLoop().catch(error =>
          this.logger.error('Application loop exited unexpectedly', {
            error: serializeError(error)
          })
        )
      }, 0)
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
        [BusState.Started, BusState.Starting]
      )
    }
    this.internalState = BusState.Stopping
    this.logger.info('Bus stopping...')

    this.stopInProgress = this.stopTransportAndWorkers()
    try {
      await this.stopInProgress
    } finally {
      this.stopInProgress = undefined
    }
  }

  /**
   * Stops and disposes all resources allocated to the bus, as well as removing
   * all handler registrations.
   *
   * The bus instance can not be used after this has been called. If the bus is
   * already stopping, this waits for that stop to complete rather than stopping again.
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing bus instance...')
    this.unsubscribeFromInterruptSignals()
    if (this.stopInProgress) {
      await this.stopInProgress
    } else if ([BusState.Started, BusState.Starting].includes(this.state)) {
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

  private async stopTransportAndWorkers(): Promise<void> {
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
   * Runs a single worker. `runningWorkerCount` is incremented by `start()` when the worker is
   * scheduled, and decremented here once the worker exits.
   */
  private async applicationLoop(): Promise<void> {
    try {
      // Run the loop in a cls-hooked namespace to provide the message handling context to all async operations
      while (this.internalState === BusState.Started) {
        const messageHandled = await this.handleNextMessage()

        // Avoids locking up CPU when there are no messages to be processed
        if (!messageHandled) {
          await sleep(EMPTY_QUEUE_SLEEP_MS)
        }
      }
    } finally {
      this.runningWorkerCount--
    }
  }

  private async handleNextMessage(): Promise<boolean> {
    try {
      const message = await this.transport.readNextMessage()
      if (message) {
        return this.handleReceivedMessage(message)
      }
    } catch (error) {
      this.logger.error(
        'Failed to handle and dispatch message from transport',
        { error: serializeError(error) }
      )
    }
    return false
  }

  private async handleReceivedMessage(
    message: TransportMessage<TTransportMessage>
  ): Promise<boolean> {
    let handled = false
    let returnedToReceiverHost = false
    try {
      Object.freeze(message)

      this.logger.debug('Message read from transport', { message })
      this.afterReceive.emit({ message })

      handled = await messageHandlingContext.run(
        message,
        async () => {
          try {
            await messageLifecycleContext.run(
              { messageReturnedToQueue: false },
              async () => {
                await this.messageReadMiddleware.dispatch(message)
                returnedToReceiverHost =
                  !!this.receiver &&
                  messageLifecycleContext.get().messageReturnedToQueue

                this.afterDispatch.emit({
                  message: message.domainMessage,
                  attributes: message.attributes
                })
              }
            )

            return true
          } catch (error) {
            this.logger.error(
              'Message was unsuccessfully handled. Returning to queue.',
              {
                busMessage: message,
                error: serializeError(error)
              }
            )
            this.onError.emit({
              message: message.domainMessage,
              error: error as Error,
              attributes: message.attributes,
              rawMessage: message
            })

            // Receivers expect the host to return the message to the queue for retry
            if (this.receiver) {
              throw error
            }
            await this.transport.returnMessage(message)
            return false
          }
        },
        true
      )
    } catch (error) {
      this.logger.error(
        'Failed to handle and dispatch message from transport',
        { error: serializeError(error) }
      )
      // Receivers expect the host to return the message to the queue for retry
      if (this.receiver) {
        throw error
      }
    }

    if (returnedToReceiverHost) {
      // The receiver host deletes messages that succeed, so a returned message must be reported as failed
      this.logger.debug(
        'Message was returned to queue by a handler and will be reported to the receiver host as failed',
        { message }
      )
      throw new ReceivedMessageReturnedToQueue(message)
    }
    return handled
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

  /**
   * Buffers an outgoing message in the current handler's outbox, if there is one.
   * @returns true if the outbox took the message (buffered or dropped), or false if it should be dispatched now
   */
  private addToOutbox(outgoingMessage: OutboxedMessage): boolean {
    // The outbox only exists while a handler is running. Sends from elsewhere in the handling context, such as
    // read middleware or lifecycle listeners, have no outbox and are dispatched directly.
    const outbox = this.outbox.getStore()
    if (!outbox) {
      return false
    }

    const message = outgoingMessage.command || outgoingMessage.event
    switch (outbox.state) {
      case OutboxState.Open:
        outbox.messages.push(outgoingMessage)
        return true
      case OutboxState.Flushed:
        this.logger.warn(
          'Message was sent after its handler resolved, so it will be dispatched immediately instead of outboxed. Await all sends in the handler to avoid this.',
          { message }
        )
        return false
      case OutboxState.Discarded:
        this.logger.warn(
          'Message was sent after its handler failed and will be dropped',
          { message }
        )
        return true
    }
  }

  private logListenerRejected(emitterName: string) {
    return (error: unknown) =>
      this.logger.error('Async lifecycle listener rejected', {
        emitterName,
        error: serializeError(error)
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
          ? handlingContext.attributes.correlationId
          : undefined) ||
        randomUUID(),
      attributes: clientOptions.attributes || {},
      stickyAttributes: {
        ...(handlingContext ? handlingContext.attributes.stickyAttributes : {}),
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
    let handlerCallback: () => Promise<void>

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
        throw new ClassHandlerNotResolved((e as Error).message)
      }

      handlerCallback = async () => handlerInstance!.handle(message, attributes)
    } else {
      const fnHandler = handler as FunctionHandler<Message>
      handlerCallback = async () => fnHandler(message, attributes)
    }

    const outbox: Outbox = { state: OutboxState.Open, messages: [] }
    await this.outbox.run(outbox, async () => {
      try {
        await handlerCallback()
      } catch (error) {
        outbox.state = OutboxState.Discarded
        outbox.messages = []
        throw error
      }

      // Close the outbox before flushing so that any later sends go straight to the transport instead of being lost
      outbox.state = OutboxState.Flushed
      const outboxedMessages = outbox.messages
      outbox.messages = []
      if (outboxedMessages.length > 0) {
        // In case of a large number of messages to send, use a worker pool to dispatch so that we don't blow out heap usage
        const dispatchWorkerCount = Math.min(outboxedMessages.length, 10)
        const workers = new Array(dispatchWorkerCount)
          .fill(undefined)
          .map(async () => {
            while (true) {
              const messageToSend = outboxedMessages.shift()
              if (messageToSend === undefined) {
                break
              }

              const { command, event, attributes } = messageToSend
              if (command) {
                await this.transport.send(command, attributes)
                this.afterSend.emit({ command, attributes })
              } else if (event) {
                await this.transport.publish(event, attributes)
                this.afterPublish.emit({ event, attributes })
              }
            }
          })

        await Promise.all(workers)
      }
    })
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

    const { messageReturnedToQueue } = messageLifecycleContext.get()
    if (messageReturnedToQueue) {
      this.logger.debug(
        'Message was returned to queue by a handler and will not be deleted',
        { message }
      )
      // Receivers assume that the the host is responsible for deleting successful messages
    } else if (!this.receiver) {
      await this.transport.deleteMessage(message)
    }

    return next()
  }

  /**
   * Subscribes to the interrupt signals to gracefully stop the bus. Listeners are
   * registered once per instance and removed when the bus is disposed.
   */
  /**
   * Checks every handled message and workflow state can be restored from the configured message types
   * @throws MessageTypesMissing if any of them has no entry
   */
  private assertMessageTypesRegistered(): void {
    const { messageTypes } = this.coreDependencies
    if (!messageTypes) {
      return
    }
    const missingNames = [
      ...this.handlerRegistry.getMessageNames(),
      ...this.workflowRegistry.getWorkflowStateNames()
    ].filter(name => !Object.hasOwn(messageTypes.messages, name))
    if (missingNames.length) {
      throw new MessageTypesMissing(missingNames)
    }
  }

  private subscribeToInterruptSignals(signals: NodeJS.Signals[]): void {
    if (this.sendOnly) {
      // Only applies to message handling buses
      return
    }

    const startedStates = [BusState.Started, BusState.Starting]
    signals.forEach(signal => {
      const listener = () => {
        if (!startedStates.includes(this.state)) {
          // No need to stop a non-started bus
          return
        }
        this.logger.info(`Received ${signal} signal. Stopping bus...`)
        // Signal listeners can't be awaited, so log a failed stop instead of leaving it unhandled
        this.stop().catch(error =>
          this.logger.error('Failed to stop bus after an interrupt signal', {
            signal,
            error: serializeError(error)
          })
        )
      }
      process.on(signal, listener)
      this.interruptSignalListeners.push({ signal, listener })
    })
  }

  /**
   * Removes the interrupt signal listeners added by `subscribeToInterruptSignals()`
   */
  private unsubscribeFromInterruptSignals(): void {
    this.interruptSignalListeners.forEach(({ signal, listener }) =>
      process.off(signal, listener)
    )
    this.interruptSignalListeners = []
  }
}
