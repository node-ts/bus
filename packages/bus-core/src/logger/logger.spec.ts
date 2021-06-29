import { Mock, Times } from 'typemoq'
import { getLogger, Logger } from '.'
import { Bus } from '../service-bus'

describe('Logger', () => {
  describe('when using a custom logger', () => {
    const mockLogger = Mock.ofType<Logger>()

    beforeAll(() => {
      Bus.configure().withLogger((_: string) => mockLogger.object)
    })

    beforeEach(() => {
      mockLogger.reset()
    })

    it.each(['debug', 'trace', 'info', 'warn', 'error', 'fatal'])
      ('it should log to %s', (level: string) => {
      getLogger('example')[level]('test')
      mockLogger.verify(l => l[level]('test'), Times.once())
    })
  })
})
