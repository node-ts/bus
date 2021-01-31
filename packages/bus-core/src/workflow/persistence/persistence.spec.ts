import { getPersistence, Persistence, setPersistence } from './persistence'
import { PersistenceNotConfigured } from './error'

describe('Persistence', () => {
  describe('when getting persistence before its been set', () => {
    it('should throw a PersistenceNotConfigured error', () => {
      setPersistence(undefined as any as Persistence)
      expect(() => getPersistence()).toThrowError(PersistenceNotConfigured)
    })
  })
  describe('when getting persistence after its been set', () => {
    it('should return the persistence', () => {
      const persistence = {} as any as Persistence
      setPersistence(persistence)
      expect(getPersistence()).toEqual(persistence)
    })
  })
})
