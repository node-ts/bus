import { BusInstance } from './bus-instance'
import { Transport } from '../transport'
import {
  Command,
  Event,
  MessageAttributes
} from '@node-ts/bus-messages'
import { CoreDependencies, MiddlewareDispatcher } from '../util'
import { HandlerRegistry } from '../handler'
import { WorkflowRegistry } from '../workflow/registry'
import { Logger } from '../logger'
import { ContainerAdapter } from '../container'
import { Receiver } from '../receiver'
import { messageHandlingContext }
  from '../message-handling-context' // To test prepareTransportOptions behavior

// Mock external modules and dependencies
jest.mock('../workflow/registry')
jest.mock('../util/middleware-dispatcher')
jest.mock('../handler/handler-registry')
jest.mock('../logger')
// jest.mock('uuid', () => ({ v4: () => 'mock-uuid' })) // If generateUuid is directly used and needs mocking

// Define mock types explicitly
type MockTransport = jest.Mocked<Transport>
type MockLogger = jest.Mocked<Logger>
type MockCoreDependencies = jest.Mocked<CoreDependencies>
type MockWorkflowRegistry = jest.Mocked<WorkflowRegistry>
type MockMiddlewareDispatcher = jest.Mocked<MiddlewareDispatcher<any>>
type MockHandlerRegistry = jest.Mocked<HandlerRegistry>
type MockContainerAdapter = jest.Mocked<ContainerAdapter>
type MockReceiver = jest.Mocked<Receiver>


describe('BusInstance', () => {
  let busInstance: BusInstance
  let mockTransport: MockTransport
  let mockLogger: MockLogger
  let mockLoggerFactory: jest.Mock<MockLogger>
  let mockCoreDependencies: MockCoreDependencies
  let mockWorkflowRegistry: MockWorkflowRegistry
  let mockMessageReadMiddleware: MockMiddlewareDispatcher
  let mockHandlerRegistry: MockHandlerRegistry
  let mockContainer: MockContainerAdapter | undefined
  let mockReceiver: MockReceiver | undefined

  const concurrency = 1
  const sendOnly = false

  // Sample messages and attributes for testing
  class TestCommand implements Command {
    $name = 'test-command'
    $version = 1
    constructor(public readonly id: string) {}
  }

  class TestEvent implements Event {
    $name = 'test-event'
    $version = 1
    constructor(public readonly id: string) {}
  }

  beforeEach(() => {
    mockTransport = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      publish: jest.fn(),
      send: jest.fn(),
      sendBatch: jest.fn().mockResolvedValue(undefined),
      publishBatch: jest.fn().mockResolvedValue(undefined),
      readNextMessage: jest.fn(),
      deleteMessage: jest.fn(),
      returnMessage: jest.fn(),
      fail: jest.fn(),
      initialize: jest.fn(),
      dispose: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      prepare: jest.fn()
    }

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      trace: jest.fn()
    }
    mockLoggerFactory = jest.fn(() => mockLogger)

    mockCoreDependencies = {
      loggerFactory: mockLoggerFactory,
      messageSerializer: {
        serialize: jest.fn(message => JSON.stringify(message)),
        deserialize: jest.fn(messageStr => JSON.parse(messageStr))
      },
      handlerRegistry: new HandlerRegistry(mockLoggerFactory) as any, // Actual instance or mock
      interruptSignals: []
      // ... other properties if needed by BusInstance constructor or prepareTransportOptions
    } as unknown as MockCoreDependencies // Use unknown for partial mock

    mockWorkflowRegistry =
      new WorkflowRegistry(undefined, undefined) as MockWorkflowRegistry
    mockMessageReadMiddleware =
      new MiddlewareDispatcher<any>() as MockMiddlewareDispatcher
    mockHandlerRegistry = new HandlerRegistry(mockLoggerFactory) as MockHandlerRegistry
    mockContainer = undefined
    mockReceiver = undefined


    busInstance = new BusInstance(
      mockTransport,
      concurrency,
      mockWorkflowRegistry,
      mockCoreDependencies,
      mockMessageReadMiddleware,
      mockHandlerRegistry,
      mockContainer,
      sendOnly,
      mockReceiver
    )
  })

  describe('sendBatch', () => {
    const commands: TestCommand[] = [
      new TestCommand('1'),
      new TestCommand('2')
    ]

    it('should call transport.sendBatch with commands and attributes when attributes are provided', async () => {
      const messageAttributes: Partial<MessageAttributes> = { correlationId: 'test-corid', attributes: { 'custom': 'value' } }
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: 'test-corid',
        attributes: { 'custom': 'value' }
      })

      await busInstance.sendBatch(commands, messageAttributes)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sending command batch',
        { commands, messageAttributes }
      )
      expect(mockTransport.sendBatch).toHaveBeenCalledWith(
        commands,
        expectedAttributesMatcher
      )
    })

    it('should call transport.sendBatch with commands and generated attributes when no attributes are provided', async () => {
      // Mock generateUuid if not already done and if it's a direct dependency of prepareTransportOptions
      // For this test, we'll rely on the fact that prepareTransportOptions generates a correlationId.
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: expect.any(String), // Should be generated
        attributes: {} // Default
      })

      await busInstance.sendBatch(commands)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sending command batch',
        { commands, messageAttributes: {} } // Default is empty object
      )
      expect(mockTransport.sendBatch).toHaveBeenCalledWith(
        commands,
        expectedAttributesMatcher
      )
    })

    it('should use correlationId from message handling context if available and no explicit correlationId is passed', async () => {
      const contextCorrelationId = 'context-corid'
      const handlingContext = {
        message: {} as any,
        attributes: { correlationId: contextCorrelationId, attributes: {}, stickyAttributes: {} }
      }
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: contextCorrelationId
      })

      await messageHandlingContext.run(handlingContext, async () => {
        await busInstance.sendBatch(commands, { attributes: { 'key': 'val'} });
      });

      expect(mockTransport.sendBatch).toHaveBeenCalledWith(
        commands,
        expectedAttributesMatcher
      );
    });
  })

  describe('publishBatch', () => {
    const events: TestEvent[] = [
      new TestEvent('ev1'),
      new TestEvent('ev2')
    ]

    it('should call transport.publishBatch with events and attributes when attributes are provided', async () => {
      const messageAttributes: Partial<MessageAttributes> = { correlationId: 'test-corid-event', attributes: { 'eventProp': 'eventValue' } }
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: 'test-corid-event',
        attributes: { 'eventProp': 'eventValue' }
      })

      await busInstance.publishBatch(events, messageAttributes)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Publishing event batch',
        { events, messageAttributes }
      )
      expect(mockTransport.publishBatch).toHaveBeenCalledWith(
        events,
        expectedAttributesMatcher
      )
    })

    it('should call transport.publishBatch with events and generated attributes when no attributes are provided', async () => {
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: expect.any(String), // Should be generated
        attributes: {} // Default
      })

      await busInstance.publishBatch(events)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Publishing event batch',
        { events, messageAttributes: {} } // Default is empty object
      )
      expect(mockTransport.publishBatch).toHaveBeenCalledWith(
        events,
        expectedAttributesMatcher
      )
    })

     it('should use correlationId from message handling context if available and no explicit correlationId is passed for publish', async () => {
      const contextCorrelationId = 'context-corid-publish'
      const handlingContext = {
        message: {} as any,
        attributes: { correlationId: contextCorrelationId, attributes: {}, stickyAttributes: {} }
      }
      const expectedAttributesMatcher = expect.objectContaining({
        correlationId: contextCorrelationId
      })

      await messageHandlingContext.run(handlingContext, async () => {
        await busInstance.publishBatch(events, { attributes: { 'key': 'val'} });
      });

      expect(mockTransport.publishBatch).toHaveBeenCalledWith(
        events,
        expectedAttributesMatcher
      );
    });
  })
})
