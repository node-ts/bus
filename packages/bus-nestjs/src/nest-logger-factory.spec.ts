import { Logger, LoggerService } from '@nestjs/common'
import { nestLoggerFactory } from './nest-logger-factory'

/**
 * Records each call Nest's `Logger` passes on to the application's logger
 */
class RecordingLogger implements LoggerService {
  readonly calls: unknown[][] = []

  log(...args: unknown[]): void {
    this.calls.push(['log', ...args])
  }

  error(...args: unknown[]): void {
    this.calls.push(['error', ...args])
  }

  warn(...args: unknown[]): void {
    this.calls.push(['warn', ...args])
  }

  debug(...args: unknown[]): void {
    this.calls.push(['debug', ...args])
  }

  verbose(...args: unknown[]): void {
    this.calls.push(['verbose', ...args])
  }

  fatal(...args: unknown[]): void {
    this.calls.push(['fatal', ...args])
  }
}

describe('nestLoggerFactory', () => {
  const nestLogger = new RecordingLogger()
  const target = '@node-ts/bus-core:service-bus'

  beforeAll(() => {
    Logger.overrideLogger(nestLogger)
    const sut = nestLoggerFactory(target)
    sut.debug('Debug message', { id: 1 })
    sut.trace('Trace message')
    sut.info('Info message', { id: 2 })
    sut.warn('Warn message')
    sut.error('Error message', { id: 3 })
    sut.fatal('Fatal message')
  })

  it('should write each level to Nest, with the component as the context', () => {
    expect(nestLogger.calls).toEqual([
      ['debug', 'Debug message', { id: 1 }, target],
      ['verbose', 'Trace message', target],
      ['log', 'Info message', { id: 2 }, target],
      ['warn', 'Warn message', target],
      ['error', 'Error message', { id: 3 }, target],
      ['fatal', 'Fatal message', target]
    ])
  })
})
