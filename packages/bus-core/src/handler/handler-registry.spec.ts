import { handlerRegistry } from './handler-registry'
import { Mock, IMock, It, Times } from 'typemoq'
import { Logger } from '@node-ts/logger-core'
import { TestEvent, testEventHandler, MessageLogger, TestCommand } from '../test'
import { HandlerAlreadyRegistered } from './errors'
import { setLogger } from '../util'
import { Handler } from './handler'

describe('HandlerRegistry', () => {

  let logger: IMock<Logger>

  const messageName = TestEvent.NAME
  const messageLoggerMock = Mock.ofType<MessageLogger>()
  const handler = testEventHandler(messageLoggerMock.object)
  const messageType = TestEvent
  const genericHandler = () => undefined

  beforeAll(() => {
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

  describe('when getting a handler for a message with no registered handlers', () => {
    let handlers: Handler[]
    beforeEach(() => {
      handlers = handlerRegistry.get('abc')
    })

    it('should return an empty array of handlers', () => {
      expect(handlers).toHaveLength(0)
    })

    it('should log an error', () => {
      logger.verify(
        l => l.error(`No handlers were registered for message`, It.isObjectWith({ messageName: 'abc' })),
        Times.once()
      )
    })

    describe('when the same message is handled again', () => {
      it('should not keep logging the error', () => {
        handlerRegistry.get('abc')
        handlerRegistry.get('abc')
        handlerRegistry.get('abc')
        logger.verify(
          l => l.error(`No handlers were registered for message`, It.isObjectWith({ messageName: 'abc' })),
          Times.once()
        )
      })
    })
  })

  describe('when getting the list of messages registered with the handler', () => {
    it('should return the full set as an array', () => {
      handlerRegistry.register(TestEvent, genericHandler)
      handlerRegistry.register(TestCommand, genericHandler)

      const registeredMessages = handlerRegistry.getMessageNames();
      [TestEvent, TestCommand].forEach(messageType => {
        expect(registeredMessages).toContain(new messageType().$name)
      })
    })
  })

  describe('when getting a message constructor', () => {
    describe('for a registered message', () => {
      it('should return a message constructor', () => {
        handlerRegistry.register(TestEvent, genericHandler)
        const ctor = handlerRegistry.getMessageConstructor(TestEvent.NAME)
        expect(ctor).toEqual(TestEvent)
      })
    })

    describe('for an unregistered message', () => {
      it('should return undefined', () => {
        const ctor = handlerRegistry.getMessageConstructor('abc')
        expect(ctor).toBeUndefined()
      })
    })
  })

})
