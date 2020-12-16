import { Bus } from './bus'
import { BusAlreadyInitialized, BusNotInitialized } from './error'
import { TestEvent } from '../test'
import { Logger } from '@node-ts/logger-core'
import { Persistence, Workflow } from '../workflow'
import { Serializer } from '../serialization'

describe('Bus', () => {
  describe('when getting the service bus prior to initialization', () => {
    it('should throw a BusNotInitialized error', async () => {
      await expect(Bus.publish(new TestEvent())).rejects.toBeInstanceOf(BusNotInitialized)
    })
  })

  describe('when configuring Bus after initialization', () => {
    it('should reject', async () => {
      const config = Bus.configure()
      await config.initialize()
      expect(() => Bus.configure()).toThrowError(BusAlreadyInitialized)
      expect(() => config.withHandler(TestEvent, () => undefined)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withLogger({} as Logger)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withPersistence({} as Persistence)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withSerializer({} as Serializer)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withWorkflow({} as Workflow)).toThrowError(BusAlreadyInitialized)
    })
  })
})
