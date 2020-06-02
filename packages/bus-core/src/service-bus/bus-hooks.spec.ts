import { BusHooks } from './bus-hooks'

describe('BusHooks', () => {
  let sut: BusHooks

  beforeEach(() => {
    sut = new BusHooks()
  })

  describe('send hooks', () => {
    it('adding should push to the array', () => {
      const callback = () => undefined
      sut.on('send', callback)
      expect(sut.send).toHaveLength(1)
    })

    it('removing should splice from the array', () => {
      const callback = () => undefined
      sut.on('send', callback)
      expect(sut.send).toHaveLength(1)
      sut.off('send', () => undefined)
      expect(sut.send).toHaveLength(1)
      sut.off('send', callback)
      expect(sut.send).toHaveLength(0)
      sut.off('send', callback)
      expect(sut.send).toHaveLength(0)
    })
  })

  describe('publish hooks', () => {
    it('adding should push to the array', () => {
      const callback = () => undefined
      sut.on('publish', callback)
      expect(sut.publish).toHaveLength(1)
    })

    it('removing should splice from the array', () => {
      const callback = () => undefined
      sut.on('publish', callback)
      expect(sut.publish).toHaveLength(1)
      sut.off('publish', () => undefined)
      expect(sut.publish).toHaveLength(1)
      sut.off('publish', callback)
      expect(sut.publish).toHaveLength(0)
      sut.off('publish', callback)
      expect(sut.publish).toHaveLength(0)
    })
  })
})
