import * as sut from './index'

describe('index', () => {
  describe('when importing the package root', () => {
    it('should export the errors the persistence throws to callers', () => {
      expect(sut.WorkflowStateNotFound).toEqual(expect.any(Function))
    })
  })
})
