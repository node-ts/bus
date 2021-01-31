import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { Container, inject, injectable } from 'inversify'
import { BUS_SYMBOLS } from '../bus-symbols'
import { Handler, HandlerPrototype, MessageType } from '../handler/handler'
import { HandlerRegistry } from '../handler'
import { Bus } from '../service-bus'
import { ClassConstructor } from '../util'
import { Transport } from '../transport'

@injectable()
export class ApplicationBootstrap {

  private isInitialized = false

  constructor (
    @inject(BUS_SYMBOLS.Bus) private bus: Bus,
    @inject(BUS_SYMBOLS.Transport) private transport: Transport,
    @inject(BUS_SYMBOLS.HandlerRegistry) private handlerRegistry: HandlerRegistry,
    @inject(LOGGER_SYMBOLS.Logger) private logger: Logger
  ) {
  }

  async initialize (container: Container): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Application already initialized')
    }
    this.logger.info('Initializing bus application...')
    this.handlerRegistry.bindHandlersToContainer(container)
    await this.initializeTransport()
    await this.bus.start()
    this.isInitialized = true
    this.logger.info('Bus application initialized')
  }

  async initializeSendOnly (): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Application already initialized')
    }
    if (this.handlerRegistry.messageSubscriptions.length > 0) {
      throw new Error('A send-only bus cannot have registered handlers')
    }
    this.logger.info('Initializing send only bus application...')
    await this.initializeTransport()
    this.isInitialized = true
    this.logger.info('Send only bus application initialized')
  }

  async dispose (): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Application has not been initialized')
    }

    this.logger.info('Disposing bus application...')

    await this.bus.stop()

    if (this.transport.dispose) {
      await this.transport.dispose()
    }

    this.logger.info('Bus application disposed')
  }

  registerHandler (handler: ClassConstructor<Handler<MessageType>>): void {
    if (this.isInitialized) {
      throw new Error('Cannot call registerHandler() after initialize() has been called')
    }

    const prototype = handler.prototype as HandlerPrototype<MessageType>
    if (!prototype.$symbol) {
      throw new Error(
        `Missing symbol on ${prototype.constructor}.`
        + 'This could mean the handler class is missing the @Handles() decorator.'
      )
    }

    this.handlerRegistry.register(
      prototype.$resolver,
      prototype.$symbol,
      handler,
      prototype.$message,
      prototype.$topicIdentifier
    )
  }

  private async initializeTransport (): Promise<void> {
    if (this.transport.initialize) {
      await this.transport.initialize()
    }
  }
}
