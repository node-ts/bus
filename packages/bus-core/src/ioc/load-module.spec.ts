import { ContainerModule } from 'inversify'
import { loadModule } from './load-module'
import { getInstance } from './get-instance'

const TEST_SYMBOL = Symbol.for('load-module')
const value = 'abc'

class TestModule extends ContainerModule {
  constructor () {
    super(bind => {
      bind(TEST_SYMBOL).toConstantValue(value)
    })
  }
}

describe('loadModule', () => {
  describe('when loading a bus module', () => {
    it('should allow retrieval of module instances', () => {
      loadModule(new TestModule())
      expect(getInstance(TEST_SYMBOL)).toEqual(value)
    })
  })
})
