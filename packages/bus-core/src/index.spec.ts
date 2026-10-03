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
        PersistenceNotConfigured: expect.any(Function),
        TransportHeaderReserved: expect.any(Function),
        WorkflowHandlerFailed: expect.any(Function),
        WorkflowStateNotInitialized: expect.any(Function)
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
