import { getInstance } from './get-instance'
import { ServiceBus } from '../service-bus'

describe('getInstance', () => {
  describe('when getting an object registered into the container', () => {
    it('should return an instance', () => {
      expect(getInstance(ServiceBus)).toBeInstanceOf(ServiceBus)
    })

    it('should not duplicate containers', () => {
      const instance1 = getInstance(ServiceBus)
      const instance2 = getInstance(ServiceBus)
      expect(instance1).toEqual(instance2)
    })
  })
})
