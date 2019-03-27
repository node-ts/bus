import { Message } from '@node-ts/bus-messages'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { Container, inject, injectable } from 'inversify'
import { BUS_SYMBOLS } from '../bus-symbols'
import { Handler, HandlerPrototype } from '../handler/handler'
import { HandlerRegistry } from '../handler'
import { Bus } from '../service-bus'
import { ClassConstructor } from '../util'

@injectable()
export class ApplicationBootstrap {

  private isInitialized = false

  constructor (
    @inject(BUS_SYMBOLS.Bus) private bus: Bus,
    @inject(BUS_SYMBOLS.HandlerRegistry) private handlerRegistry: HandlerRegistry,
    @inject(LOGGER_SYMBOLS.Logger) private logger: Logger
  ) {
  }

  async initialize (container: Container): Promise<void> {
    this.logger.info('Initializing bus application')
    this.handlerRegistry.bindHandlersToContainer(container)
    await this.bus.start()
    this.isInitialized = true
  }

  registerHandler (handler: ClassConstructor<Handler<Message>>): void {
    if (this.isInitialized) {
      throw new Error('Cannot call registerHandler() after initialize() has been called')
    }

    const prototype = handler.prototype as HandlerPrototype
    if (!prototype.$symbol) {
      throw new Error(
        `Missing symbol on ${prototype.constructor}.`
        + 'This could mean the handler class is missing the @Handles() decorator.'
      )
    }

    if (!prototype.$messageName) {
      throw new Error(
        `Missing message type on ${prototype.constructor}.`
        + 'This could mean the handler class is missing the @Handles() decorator.'
      )
    }

    this.handlerRegistry.register(
      prototype.$messageName,
      prototype.$symbol,
      handler,
      prototype.$message
    )
  }
}
