import { Command } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { Logger, LoggerFactory } from '../logger'
import {
  MessageLogger,
  TestCommand,
  TestCommand2,
  TestDefinedCommand,
  TestEvent,
  testEventHandler
} from '../test'
import { DefaultHandlerRegistry } from './default-handler-registry'
import {
  HandlerAlreadyRegistered,
  MessageNameInherited,
  MessageNameMissing
} from './error'
import { HandlerDefinition, MessageBase } from './handler'

describe('HandlerRegistry', () => {
  let logger: IMock<Logger>
  let loggerFactory: LoggerFactory

  const messageLoggerMock = Mock.ofType<MessageLogger>()
  const handler = testEventHandler(messageLoggerMock.object)
  const messageType = TestEvent
  const genericHandler = () => undefined
  const handlerRegistry = new DefaultHandlerRegistry()

  beforeAll(() => {
    logger = Mock.ofType<Logger>()
    loggerFactory = () => logger.object
  })

  afterEach(() => handlerRegistry.reset())

  describe('when registering a handler', () => {
    beforeEach(() =>
      handlerRegistry.register(handler.messageType, handler.messageHandler)
    )

    it('should register the handler', () => {
      const handlers = handlerRegistry.get(loggerFactory, new messageType())
      expect(handlers).toHaveLength(1)
    })
  })

  describe('when registering a handler for a message class whose constructor needs arguments', () => {
    let constructed = false

    class TestCommandWithArguments extends Command {
      static NAME = '@node-ts/bus-core/test-command-with-arguments'
      $name = TestCommandWithArguments.NAME
      $version = 0

      constructor(readonly orderId: string) {
        super()
        constructed = true
      }
    }

    beforeEach(() =>
      handlerRegistry.register(TestCommandWithArguments, genericHandler)
    )

    it('should register it by its static NAME without constructing it', () => {
      expect(constructed).toEqual(false)
      expect(handlerRegistry.getMessageNames()).toEqual([
        TestCommandWithArguments.NAME
      ])
    })
  })

  describe('when registering a handler for a message declared with defineCommand', () => {
    beforeEach(() =>
      handlerRegistry.register(TestDefinedCommand, genericHandler)
    )

    it('should register it by its NAME', () => {
      const handlers = handlerRegistry.get(
        loggerFactory,
        TestDefinedCommand({ orderId: 'a', placedAt: new Date() })
      )
      expect(handlers).toEqual([genericHandler])
    })

    it('should create received messages as plain objects', () => {
      expect(
        handlerRegistry.getMessageConstructor(TestDefinedCommand.NAME)
      ).toBe(Object)
    })
  })

  describe('when registering a handler for a message type without a static NAME', () => {
    class TestCommandWithoutName extends Command {
      $name = '@node-ts/bus-core/test-command-without-name'
      $version = 0
    }

    let error: unknown

    beforeEach(() => {
      try {
        // @ts-expect-error a message class without a static NAME doesn't type check
        handlerRegistry.register(TestCommandWithoutName, genericHandler)
      } catch (caught) {
        error = caught
      }
    })

    it('should throw MessageNameMissing naming the class', () => {
      expect(error).toBeInstanceOf(MessageNameMissing)
      expect((error as MessageNameMissing).message).toContain(
        'TestCommandWithoutName has no static NAME'
      )
    })
  })

  describe('when registering a handler for a subclass that inherits its static NAME', () => {
    class TestParentCommand extends Command {
      static NAME = '@node-ts/bus-core/test-parent-command'
      $name = TestParentCommand.NAME
      $version = 0
    }

    class TestChildCommand extends TestParentCommand {
      $name = '@node-ts/bus-core/test-child-command'
    }

    let error: unknown

    beforeEach(() => {
      error = undefined
      try {
        handlerRegistry.register(TestChildCommand, genericHandler)
      } catch (caught) {
        error = caught
      }
    })

    it('should throw MessageNameInherited naming the class and its parent', () => {
      expect(error).toBeInstanceOf(MessageNameInherited)
      expect((error as MessageNameInherited).message).toContain(
        'TestChildCommand inherits its static NAME'
      )
      expect((error as MessageNameInherited).help).toContain('static NAME =')
    })

    it('should not register it under the parent name', () => {
      expect(handlerRegistry.getMessageNames()).toEqual([])
    })
  })

  describe('when registering a handler for an undefined message type', () => {
    let error: unknown

    beforeEach(() => {
      error = undefined
      try {
        // A circular import gives undefined at runtime, though the type says otherwise
        handlerRegistry.register(
          undefined as unknown as typeof TestCommand,
          genericHandler
        )
      } catch (caught) {
        error = caught
      }
    })

    it('should throw MessageNameMissing that mentions circular imports', () => {
      expect(error).toBeInstanceOf(MessageNameMissing)
      expect((error as MessageNameMissing).message).toContain(
        'The message type is undefined'
      )
      expect((error as MessageNameMissing).help).toContain('circular import')
    })
  })

  describe('when registering a handler twice', () => {
    it('should throw a HandlerAlreadyRegistered error', () => {
      handlerRegistry.register(handler.messageType, handler.messageHandler)
      expect(() =>
        handlerRegistry.register(handler.messageType, handler.messageHandler)
      ).toThrow(HandlerAlreadyRegistered)
    })
  })

  describe('when getting a handler', () => {
    it('should return an empty array for an unregistered handler', () => {
      expect(handlerRegistry.get(loggerFactory, {})).toHaveLength(0)
    })

    it('should return a single handler for a single registration', () => {
      handlerRegistry.register(handler.messageType, handler.messageHandler)
      expect(
        handlerRegistry.get(loggerFactory, new messageType())
      ).toHaveLength(1)
    })

    it('should return a multiple handlers for multiple registrations', () => {
      handlerRegistry.register(handler.messageType, handler.messageHandler)
      handlerRegistry.register(messageType, () => undefined)
      expect(
        handlerRegistry.get(loggerFactory, new messageType())
      ).toHaveLength(2)
    })
  })

  describe('when getting a handler for a message with no registered handlers', () => {
    let handlers: HandlerDefinition<MessageBase>[]
    const unregisteredMessage = { $name: 'unregistered-message' }
    beforeEach(() => {
      handlers = handlerRegistry.get(loggerFactory, unregisteredMessage)
    })

    it('should return an empty array of handlers', () => {
      expect(handlers).toHaveLength(0)
    })

    it('should log an error', () => {
      logger.verify(
        l =>
          l.error(
            `No handlers were registered for message`,
            It.isObjectWith({ messageName: unregisteredMessage.$name })
          ),
        Times.once()
      )
    })

    describe('when the same message is handled again', () => {
      it('should not keep logging the error', () => {
        handlerRegistry.get(loggerFactory, unregisteredMessage)
        handlerRegistry.get(loggerFactory, unregisteredMessage)
        handlerRegistry.get(loggerFactory, unregisteredMessage)
        logger.verify(
          l =>
            l.error(
              `No handlers were registered for message`,
              It.isObjectWith({ messageName: unregisteredMessage.$name })
            ),
          Times.once()
        )
      })
    })
  })

  describe('when getting the list of messages registered with the handler', () => {
    it('should return the full set as an array', () => {
      handlerRegistry.register(TestEvent, genericHandler)
      handlerRegistry.register(TestCommand, genericHandler)

      const registeredMessages = handlerRegistry.getMessageNames()
      ;[TestEvent, TestCommand].forEach(messageType => {
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

  describe('when resetting the registry', () => {
    const customTopicIdentifier = 'arn:aws:sns:us-east-1:000000000000:reset'

    beforeEach(() => {
      handlerRegistry.register(TestEvent, genericHandler)
      handlerRegistry.registerCustom<TestCommand2>(genericHandler, {
        resolveWith: message => message.$name === TestCommand2.NAME,
        topicIdentifier: customTopicIdentifier
      })
      handlerRegistry.reset()
    })

    it('should remove regular handlers', () => {
      expect(handlerRegistry.getMessageNames()).toHaveLength(0)
      expect(handlerRegistry.get(loggerFactory, new TestEvent())).toHaveLength(
        0
      )
    })

    it('should remove custom handler resolvers', () => {
      expect(handlerRegistry.getResolvers()).toHaveLength(0)
      expect(
        handlerRegistry.getExternallyManagedTopicIdentifiers()
      ).toHaveLength(0)
      expect(
        handlerRegistry.get(loggerFactory, new TestCommand2())
      ).toHaveLength(0)
    })
  })

  describe('when registering a message handler using a custom resolver', () => {
    class CustomHandler {
      async handle(_: TestCommand2): Promise<void> {
        // ...
      }
    }

    beforeAll(async () => {
      handlerRegistry.registerCustom(CustomHandler, {
        resolveWith: message => message.$name === TestCommand2.NAME,
        topicIdentifier: 'arn:aws:sns:us-east-1:000000000000:s3-object-created'
      })
    })

    describe('and then getting a handler for the message type', () => {
      it('should resolve using the custom handler', () => {
        const resolvedHandlers = handlerRegistry.get(
          loggerFactory,
          new TestCommand2()
        )
        expect(resolvedHandlers).toHaveLength(1)
        expect(resolvedHandlers[0]).toEqual(CustomHandler)
      })
    })
  })
})
