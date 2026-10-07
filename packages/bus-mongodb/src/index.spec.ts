import * as sut from './index'

describe('index', () => {
  describe('when importing the package root', () => {
    it('should export the errors the persistence throws to callers', () => {
      expect(sut.WorkflowStateNotFound).toEqual(expect.any(Function))
      expect(sut.ReplicaSetRequired).toEqual(expect.any(Function))
    })

    it('should export the transaction accessor and its test helper', () => {
      expect(sut.mongoSession).toEqual(expect.any(Function))
      expect(sut.mongoTestSession).toEqual(expect.any(Function))
    })
  })
})
