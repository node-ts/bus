import { injectable, inject } from 'inversify'
import autobind from 'autobind-decorator'
import { Bus, BusState } from './bus'
import { BUS_SYMBOLS } from '../bus-symbols'
import { Transport } from '../transport'
import { Event, Command, Message } from '@node-ts/bus-messages'
import { Logger, LOGGER_SYMBOLS } from '@node-ts/logger-core'
import { sleep } from '../util'
import { HandlerRegistry } from '../handler'
import * as serializeError from 'serialize-error'

const EMPTY_QUEUE_SLEEP_MS = 500

@injectable()
@autobind
export class ServiceBus implements Bus {

  private internalState: BusState = BusState.Stopped
  private runningWorkerCount = 0

  constructor (
    @inject(BUS_SYMBOLS.Transport) private readonly transport: Transport<{}>,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.HandlerRegistry) private readonly handlerRegistry: HandlerRegistry
  ) {
  }

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    this.logger.debug('publish', { event })
    return this.transport.publish(event)
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    this.logger.debug('send', { command })
    return this.transport.send(command)
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

        try {
          await this.dispatchMessageToHandlers(message.domainMessage)
          this.logger.debug('Message dispatched to all handlers', { message })
          await this.transport.deleteMessage(message)
        } catch (error) {
          this.logger.warn(
            'Message was unsuccessfully handled. Returning to queue',
            { message, error: serializeError(error) }
          )
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

  private async dispatchMessageToHandlers (message: Message): Promise<void> {
    const handlers = this.handlerRegistry.get(message.$name)
    if (handlers.length === 0) {
      this.logger.warn(`No handlers registered for message ${message.$name}. Message will be discarded`)
      return
    }

    const handlersToInvoke = handlers.map(h => h.resolveHandler(h.defaultContainer))
    await Promise.all(handlersToInvoke.map(async h => {
      await h.handle(message)
    }))
  }
}
