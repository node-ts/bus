import { getInstance } from './get-instance'
import { BUS_SYMBOLS } from '../bus-symbols'
import { ServiceBus } from '../service-bus'

describe('getInstance', () => {
  describe('when getting an object registered into the container', () => {
    it('should return an instance', () => {
      expect(getInstance(BUS_SYMBOLS.Bus)).toBeInstanceOf(ServiceBus)
    })

    it('should not duplicate containers', () => {
      const instance1 = getInstance(BUS_SYMBOLS.Bus)
      const instance2 = getInstance(BUS_SYMBOLS.Bus)
      expect(instance1).toEqual(instance2)
    })
  })
})
