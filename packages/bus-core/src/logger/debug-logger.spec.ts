import debug from 'debug'
import { IMock, It, Mock, Times } from 'typemoq'
import { DebugLogger } from './debug-logger'

type ConsoleOutput = Pick<Console, 'warn' | 'error'>

const LOGGER_NAME = '@node-ts/bus-core:debug-logger-spec'
const META = { meta: 'example' }

describe('DebugLogger', () => {
  let consoleOutput: IMock<ConsoleOutput>
  let sut: DebugLogger

  const logAllLevels = () => {
    sut.debug('debug message', META)
    sut.trace('trace message', META)
    sut.info('info message', META)
    sut.warn('warn message', META)
    sut.error('error message', META)
    sut.fatal('fatal message')
  }

  describe('when DEBUG is not enabled for the namespace', () => {
    beforeAll(() => {
      debug.disable()
      consoleOutput = Mock.ofType<ConsoleOutput>()
      sut = new DebugLogger(LOGGER_NAME, consoleOutput.object)
      logAllLevels()
    })

    it('should write warnings to console.warn', () => {
      consoleOutput.verify(
        c => c.warn(`${LOGGER_NAME} warn message`, META),
        Times.once()
      )
    })

    it('should write errors to console.error', () => {
      consoleOutput.verify(
        c => c.error(`${LOGGER_NAME} error message`, META),
        Times.once()
      )
    })

    it('should write fatal errors to console.error', () => {
      consoleOutput.verify(
        c => c.error(`${LOGGER_NAME} fatal message`),
        Times.once()
      )
    })

    it('should not write debug, trace or info to the console', () => {
      consoleOutput.verify(c => c.warn(It.isAny(), It.isAny()), Times.once())
      consoleOutput.verify(
        c => c.error(It.isAny(), It.isAny()),
        Times.exactly(2)
      )
    })
  })

  describe('when DEBUG is enabled for the namespace', () => {
    beforeAll(() => {
      debug.enable(LOGGER_NAME)
      consoleOutput = Mock.ofType<ConsoleOutput>()
      sut = new DebugLogger(LOGGER_NAME, consoleOutput.object)
      logAllLevels()
    })

    afterAll(() => debug.disable())

    it('should not also write to the console', () => {
      consoleOutput.verify(c => c.warn(It.isAny(), It.isAny()), Times.never())
      consoleOutput.verify(c => c.error(It.isAny(), It.isAny()), Times.never())
    })
  })
})
