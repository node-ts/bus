import { BusHooks } from './bus-hooks'
import { HookAction } from './bus'

describe('BusHooks', () => {
  let sut: BusHooks

  beforeEach(() => {
    sut = new BusHooks()
  })

  describe.each([
    'error', 'publish', 'send'
  ])('%s hook', (hook: HookAction) => {
    it('adding should push to the array', () => {
      const callback = () => undefined
      sut.on(hook, callback)
      expect(sut[hook]).toHaveLength(1)
    })

    it('removing should splice from the array', () => {
      const callback = () => undefined
      sut.on(hook, callback)
      expect(sut[hook]).toHaveLength(1)
      sut.off(hook, () => undefined)
      expect(sut[hook]).toHaveLength(1)
      sut.off(hook, callback)
      expect(sut[hook]).toHaveLength(0)
      sut.off(hook, callback)
      expect(sut[hook]).toHaveLength(0)
    })
  })
})
