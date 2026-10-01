import { Logger } from './logger'
import { createDefaultLoggerFactory } from './logger-factory'

describe('createDefaultLoggerFactory', () => {
  describe('when getting loggers', () => {
    const sut = createDefaultLoggerFactory()
    const other = createDefaultLoggerFactory()
    let first: Logger
    let second: Logger
    let fromOtherFactory: Logger

    beforeAll(() => {
      first = sut('@node-ts/bus-core:test')
      second = sut('@node-ts/bus-core:test')
      fromOtherFactory = other('@node-ts/bus-core:test')
    })

    it('should reuse the logger for the same target', () => {
      expect(second).toBe(first)
    })

    it('should not share loggers with another factory', () => {
      expect(fromOtherFactory).not.toBe(first)
    })
  })
})
