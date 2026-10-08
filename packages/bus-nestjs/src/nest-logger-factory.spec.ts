import { Logger } from '@nestjs/common'
import { nestLoggerFactory } from './nest-logger-factory'
import { RecordingLogger } from './test/recording-logger'

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
