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
  })
})
