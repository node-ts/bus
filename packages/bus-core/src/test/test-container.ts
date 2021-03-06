// tslint:disable:no-unsafe-any - Any used for mock assertions

import { Container } from 'inversify'
import { LoggerModule, LOGGER_SYMBOLS, LoggerFactory, Logger } from '@node-ts/logger-core'
import { BusModule } from '../bus-module'
import { Mock, It } from 'typemoq'
import { assertUnreachable } from '../util'

export class TestContainer extends Container {

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
  }

  /**
   * Swallows logs during integration test runs. Useful in not cluttering up
   * the test output.
   *
   * @param errorLevel The error to dispay logs for. @default 'warn'
   */
  silenceLogs (errorLevel: keyof Logger = 'warn'): this {
    const factory = this.get<LoggerFactory>(LOGGER_SYMBOLS.LoggerFactory)
    const logger = factory.build('test-logger', this)

    const mockLogger = Mock.ofInstance(logger)
    logsToOutput(errorLevel).forEach(level => {
      mockLogger
        .setup(l => l[level](It.isAnyString(), It.isAny()))
        .callBase()
    })

    this.rebind(LOGGER_SYMBOLS.Logger).toConstantValue(mockLogger.object)
    return this
  }
}

function logsToOutput (errorLevel: keyof Logger): (keyof Logger)[] {
  const levels: (keyof Logger)[] = [
    'debug',
    'trace',
    'info',
    'warn',
    'error',
    'fatal'
  ]
  return levels.slice(levels.indexOf(errorLevel), levels.length)
}
