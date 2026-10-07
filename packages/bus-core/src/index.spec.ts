import type { InMemoryMessage, InMemoryQueueConfiguration } from './index'
import * as sut from './index'

describe('index', () => {
  describe('when importing the package root', () => {
    it('should export the errors the bus throws to callers', () => {
      expect(sut).toMatchObject({
        BusAlreadyInitialized: expect.any(Function),
        DelayedDeliveryNotSupported: expect.any(Function),
        InvalidDeliveryOptions: expect.any(Function),
        InvalidBusState: expect.any(Function),
        InvalidOperation: expect.any(Function),
        MiddlewareNextCalledTwice: expect.any(Function),
        OutboxNotEnabled: expect.any(Function),
        OutboxNotSupported: expect.any(Function),
        OutgoingMessageDestinationMissing: expect.any(Function),
        PersistenceNotConfigured: expect.any(Function),
        TransactionNotActive: expect.any(Function),
        TransactionRolledBack: expect.any(Function),
        OutgoingMessageStoredConcurrently: expect.any(Function),
        ResourcesNotProvisioned: expect.any(Function),
        TransportHeaderReserved: expect.any(Function),
        WorkflowHandlerFailed: expect.any(Function),
        WorkflowStateNotInitialized: expect.any(Function)
      })
    })

    it('should export how long the inbox keeps its records, for persistences that expire them', () => {
      expect(sut.INBOX_RETENTION_MS).toEqual(7 * 24 * 60 * 60_000)
    })

    it('should export the test helpers and the errors they throw', () => {
      expect(sut).toMatchObject({
        handlerContext: expect.any(Function),
        workflowContext: expect.any(Function),
        testWorkflow: expect.any(Function),
        InvalidTimeAdvance: expect.any(Function),
        MessageNotHandledByWorkflow: expect.any(Function),
        WorkflowFactoryMissing: expect.any(Function),
        InMemoryQueueDisposed: expect.any(Function),
        TEST_RETURN_ADDRESS: 'test-return-address'
      })
    })

    it('should not export the removed lifecycle emitters and read middleware', () => {
      expect(sut).not.toHaveProperty('TypedEmitter')
      expect(sut).not.toHaveProperty('MiddlewareDispatcher')
      expect(sut).not.toHaveProperty('MiddlewarePipeline')
      expect(sut).not.toHaveProperty('OutgoingMessageDispatcher')
    })

    it('should export the in-memory queue and its configuration', () => {
      const configuration: InMemoryQueueConfiguration =
        new sut.DefaultInMemoryQueueConfiguration()
      const message: Pick<InMemoryMessage, 'inFlight'> = { inFlight: false }
      expect(new sut.InMemoryQueue(configuration)).toBeInstanceOf(
        sut.InMemoryQueue
      )
      expect(message.inFlight).toEqual(false)
    })
  })
})
