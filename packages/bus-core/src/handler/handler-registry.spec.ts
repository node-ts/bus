import { handlerRegistry } from './handler-registry'
import { Mock, IMock } from 'typemoq'
import { Logger } from '@node-ts/logger-core'
import { TestEvent, testEventHandler, MessageLogger } from '../test'
import { HandlerAlreadyRegistered } from './errors'
import { setLogger } from '../util'

describe('HandlerRegistry', () => {

  let logger: IMock<Logger>

  const messageName = TestEvent.NAME
  const messageLoggerMock = Mock.ofType<MessageLogger>()
  const handler = testEventHandler(messageLoggerMock.object)
  const messageType = TestEvent

  beforeEach(() => {
    logger = Mock.ofType<Logger>()
    setLogger(logger.object)
  })
  afterEach(() => handlerRegistry.reset())

  describe('when registering a handler', () => {
    beforeEach(() => handlerRegistry.register(messageType, handler))

    it('should register the handler', () => {
      const handlers = handlerRegistry.get(messageType.NAME)
      expect(handlers).toHaveLength(1)
    })
  })

  describe('when registering a handler twice', () => {
    it('should throw a HandlerAlreadyRegistered error', () => {
      handlerRegistry.register(messageType, handler)
      expect(() => handlerRegistry.register(messageType, handler)).toThrowError(HandlerAlreadyRegistered)
    })
  })

  describe('when getting a handler', () => {
    it('should return an empty array for an unregistered handler', () => {
      expect(handlerRegistry.get('')).toHaveLength(0)
    })

    it('should return a single handler for a single registration', () => {
      handlerRegistry.register(messageType, handler)
      expect(handlerRegistry.get(messageName)).toHaveLength(1)
    })

    it('should return a multiple handlers for multiple registrations', () => {
      handlerRegistry.register(messageType, handler)
      handlerRegistry.register(messageType, () => undefined)
      expect(handlerRegistry.get(messageName)).toHaveLength(2)
    })
  })

})
