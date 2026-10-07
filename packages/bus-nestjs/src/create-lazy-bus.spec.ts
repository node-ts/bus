import { Bus, BusInstance, BusState } from '@node-ts/bus-core'
import { createLazyBus } from './create-lazy-bus'
import { BusNotBuilt } from './error'

describe('createLazyBus', () => {
  describe('when the bus is not built', () => {
    const sut = createLazyBus('billing', () => undefined)

    it('should be a BusInstance', () => {
      expect(sut).toBeInstanceOf(BusInstance)
      expect(sut.constructor).toBe(BusInstance)
    })

    it('should throw BusNotBuilt, naming the bus and member, when an accessor is read', () => {
      let error: unknown
      try {
        error = sut.state
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(BusNotBuilt)
      expect((error as BusNotBuilt).busName).toEqual('billing')
      expect((error as BusNotBuilt).member).toEqual('state')
    })

    it('should throw BusNotBuilt when a method is called', () => {
      expect(() => sut.getHandlingContext()).toThrow(BusNotBuilt)
    })

    it('should have nothing that is not a member of a bus, so Nest finds no lifecycle hooks or promise on it', () => {
      const probe = sut as unknown as Record<string, unknown>
      expect(probe.then).toBeUndefined()
      expect(probe.onModuleInit).toBeUndefined()
    })
  })

  describe('when the bus is built after a method is read', () => {
    let bus: BusInstance | undefined
    const sut = createLazyBus('default', () => bus)
    let getHandlingContext: BusInstance['getHandlingContext']
    let state: BusState

    beforeAll(() => {
      getHandlingContext = sut.getHandlingContext
      bus = Bus.configure().build()
      state = sut.state
    })

    afterAll(async () => bus?.dispose())

    it('should pass members on to the bus', () => {
      expect(state).toEqual(BusState.Stopped)
      expect(sut.canStart).toEqual(true)
    })

    it('should call the bus from a method read before it was built', () => {
      expect(getHandlingContext()).toBeUndefined()
    })

    it('should bind methods to the bus', () => {
      const { getHandlingContext: bound } = sut
      expect(bound()).toBeUndefined()
      expect(sut.getHandlingContext).toBe(bound)
    })
  })
})
