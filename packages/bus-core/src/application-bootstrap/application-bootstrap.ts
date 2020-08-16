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

  /**
   * Initialize the bus in send/receive mode. This will create an application queue,
   * subscribe topics for any message handlers and starts the application loop to
   * start receiving messages.
   * @throws When @see initialize or @see initializeSendOnly has already been called
   */
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

  /**
   * Initialize the bus in send only mode. This will not cause the creation of an
   * application queue as the bus will only be able to send messages
   * @throws When @see initialize or @see initializeSendOnly has already been called
   * @throws When one or more message handlers have been registered
   */
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

  /**
   * Stops the bus and releases all connections to the transport.
   * @throws When @see initialize or @see initializeSendOnly has not been called
   */
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
    if (!prototype.$message) {
      throw new Error(
        `Missing @Handles() decorator on ${prototype.constructor}.`
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
