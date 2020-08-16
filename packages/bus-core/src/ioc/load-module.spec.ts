import { ContainerModule } from 'inversify'
import { loadModule } from './load-module'
import { getInstance } from './get-instance'
import { ServiceBus } from '../service-bus'

describe('loadModule', () => {
  describe('when loading a bus module', () => {
    it('should allow retrieval of module instances', async () => {
      expect(getInstance(ServiceBus)).toBeInstanceOf(ServiceBus)
    })
  })
})
