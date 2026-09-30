import type { InMemoryMessage, InMemoryQueueConfiguration } from './index'
import * as sut from './index'

describe('index', () => {
  describe('when importing the package root', () => {
    it('should export the errors the bus throws to callers', () => {
      expect(sut).toMatchObject({
        BusAlreadyInitialized: expect.any(Function),
        InvalidBusState: expect.any(Function),
        InvalidOperation: expect.any(Function),
        PersistenceNotConfigured: expect.any(Function),
        WorkflowStateNotInitialized: expect.any(Function)
      })
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
