import { Bus, BusInstance, BusState } from '@node-ts/bus-core'
import { createLazyBus } from './create-lazy-bus'
import { BusNotBuilt } from './error'

/**
 * Runs `act`, returning what it threw
 */
const thrownBy = (act: () => unknown): unknown => {
  try {
    act()
  } catch (error) {
    return error
  }
  return undefined
}

describe('createLazyBus', () => {
  describe('when the bus is not built', () => {
    let sut: BusInstance
    let probe: Record<string, unknown>
    let readingState: unknown
    let callingSyncMethod: unknown
    let sending: Promise<void>
    let sendThrewSynchronously: unknown
    let asString: string

    beforeAll(() => {
      sut = createLazyBus('billing', () => undefined)
      probe = sut as unknown as Record<string, unknown>
      asString = String(sut)
      readingState = thrownBy(() => sut.state)
      callingSyncMethod = thrownBy(() => sut.getHandlingContext())
      sendThrewSynchronously = thrownBy(() => {
        sending = sut.send({ $name: 'test/command', $version: 0 })
      })
    })

    afterAll(async () => sending.catch(() => undefined))

    it('should be a BusInstance', () => {
      expect(sut).toBeInstanceOf(BusInstance)
      expect(sut.constructor).toBe(BusInstance)
    })

    it('should throw BusNotBuilt, naming the bus and member, when an accessor is read', () => {
      expect(readingState).toBeInstanceOf(BusNotBuilt)
      expect((readingState as BusNotBuilt).busName).toEqual('billing')
      expect((readingState as BusNotBuilt).member).toEqual('state')
    })

    it('should throw BusNotBuilt when a method is called', () => {
      expect(callingSyncMethod).toBeInstanceOf(BusNotBuilt)
    })

    it('should reject with BusNotBuilt, rather than throw, when an async method is called', async () => {
      expect(sendThrewSynchronously).toBeUndefined()
      await expect(sending).rejects.toBeInstanceOf(BusNotBuilt)
    })

    it('should have the members of every object', () => {
      expect(asString).toEqual('[object Object]')
      expect(probe.toString).toBe(Object.prototype.toString)
    })

    it('should have nothing else that is not a member of a bus, so Nest finds no lifecycle hooks or promise on it', () => {
      expect(probe.then).toBeUndefined()
      expect(probe.onModuleInit).toBeUndefined()
    })
  })

  describe('when the bus is built after a method is read', () => {
    let bus: BusInstance | undefined
    let sut: BusInstance
    let getHandlingContextReadEarly: BusInstance['getHandlingContext']
    let state: BusState
    let canStart: boolean
    let handlingContextFromEarlyRead: unknown
    let bound: BusInstance['getHandlingContext']
    let boundAgain: BusInstance['getHandlingContext']
    let handlingContextFromBound: unknown

    beforeAll(() => {
      sut = createLazyBus('default', () => bus)
      getHandlingContextReadEarly = sut.getHandlingContext
      bus = Bus.configure().build()
      state = sut.state
      canStart = sut.canStart
      handlingContextFromEarlyRead = getHandlingContextReadEarly()
      bound = sut.getHandlingContext
      boundAgain = sut.getHandlingContext
      handlingContextFromBound = bound()
    })

    afterAll(async () => bus?.dispose())

    it('should pass members on to the bus', () => {
      expect(state).toEqual(BusState.Stopped)
      expect(canStart).toEqual(true)
    })

    it('should call the bus from a method read before it was built', () => {
      expect(handlingContextFromEarlyRead).toBeUndefined()
    })

    it('should bind methods to the bus, once', () => {
      expect(handlingContextFromBound).toBeUndefined()
      expect(boundAgain).toBe(bound)
    })
  })
})
