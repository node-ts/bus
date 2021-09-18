import { handlerRegistry } from './handler-registry'
import { Mock, IMock, It, Times } from 'typemoq'
import { TestEvent, testEventHandler, MessageLogger, TestCommand, TestCommand2 } from '../test'
import { HandlerAlreadyRegistered } from './errors'
import { defaultLoggerFactory, Logger, setLogger } from '../logger'
import { Handler } from './handler'
import { Message } from '@node-ts/bus-messages'

describe('HandlerRegistry', () => {

  let logger: IMock<Logger>

  const messageLoggerMock = Mock.ofType<MessageLogger>()
  const handler = testEventHandler(messageLoggerMock.object)
  const messageType = TestEvent
  const genericHandler = () => undefined

  beforeAll(() => {
    logger = Mock.ofType<Logger>()
    setLogger(() => logger.object)
  })

  afterAll(() => {
    setLogger(defaultLoggerFactory)
  })

  afterEach(() => handlerRegistry.reset())

  describe('when registering a handler', () => {
    beforeEach(() => handlerRegistry.register(messageType, handler))

    it('should register the handler', () => {
      const handlers = handlerRegistry.get(new messageType())
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
      expect(handlerRegistry.get({})).toHaveLength(0)
    })

    it('should return a single handler for a single registration', () => {
      handlerRegistry.register(messageType, handler)
      expect(handlerRegistry.get(new messageType())).toHaveLength(1)
    })

    it('should return a multiple handlers for multiple registrations', () => {
      handlerRegistry.register(messageType, handler)
      handlerRegistry.register(messageType, () => undefined)
      expect(handlerRegistry.get(new messageType())).toHaveLength(2)
    })
  })

  describe('when getting a handler for a message with no registered handlers', () => {
    let handlers: Handler<Message>[]
    const unregisteredMessage = { $name: 'unregistered-message' }
    beforeEach(() => {
      handlers = handlerRegistry.get(unregisteredMessage)
    })

    it('should return an empty array of handlers', () => {
      expect(handlers).toHaveLength(0)
    })

    it('should log an error', () => {
      logger.verify(
        l => l.error(`No handlers were registered for message`, It.isObjectWith({ messageName: unregisteredMessage.$name })),
        Times.once()
      )
    })

    describe('when the same message is handled again', () => {
      it('should not keep logging the error', () => {
        handlerRegistry.get(unregisteredMessage)
        handlerRegistry.get(unregisteredMessage)
        handlerRegistry.get(unregisteredMessage)
        logger.verify(
          l => l.error(`No handlers were registered for message`, It.isObjectWith({ messageName: unregisteredMessage.$name })),
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

  describe('when registering a message handler using a custom resolver', () => {
    class CustomHandler {
      async handle (_: TestCommand2): Promise<void> {
        // ...
      }
    }

    beforeAll(async () => {
      handlerRegistry.registerCustom(
        CustomHandler,
        {
          resolveWith: (message) => message.$name === TestCommand2.NAME,
          topicIdentifier: 'arn:aws:sns:us-east-1:000000000000:s3-object-created'
        }
      )
    })

    describe('and then getting a handler for the message type', () => {
      it('should resolve using the custom handler', () => {
        const resolvedHandlers = handlerRegistry.get(new TestCommand2())
        expect(resolvedHandlers).toHaveLength(1)
        expect(resolvedHandlers[0]).toEqual(CustomHandler)
      })
    })
  })

})
