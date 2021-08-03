// tslint:disable:no-unsafe-any - Any used for mock assertions

import { Container } from 'inversify'
import { LoggerModule, LOGGER_SYMBOLS, LoggerFactory, Logger } from '@node-ts/logger-core'
import { BusModule } from '../bus-module'
import { Mock, It } from 'typemoq'

export class TestContainer extends Container {

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
  }

  /**
   * Swallows logs during integration test runs. Useful in not cluttering up
   * the test output.
   */
  silenceLogs (): this {
    const factory = this.get<LoggerFactory>(LOGGER_SYMBOLS.LoggerFactory)
    const logger = factory.build('test-logger', this)
    const mockLogger = Mock.ofInstance(logger)
    this.rebind(LOGGER_SYMBOLS.Logger).toConstantValue(mockLogger.object)
    return this
  }
}
