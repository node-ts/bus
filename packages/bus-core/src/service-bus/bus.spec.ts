import { Bus } from './bus'
import { BusAlreadyInitialized, BusNotInitialized } from './error'
import { TestEvent } from '../test'
import { Persistence, Workflow } from '../workflow'
import { Serializer } from '../serialization'
import { Logger } from '../logger'

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
      expect(() => config.withLogger(() => ({} as Logger))).toThrowError(BusAlreadyInitialized)
      expect(() => config.withPersistence({} as Persistence)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withSerializer({} as Serializer)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withWorkflow({} as Workflow)).toThrowError(BusAlreadyInitialized)
      await Bus.dispose()
    })
  })

  describe('when configuring bus concurrency', () => {
    afterEach(async () => Bus.dispose())

    it('should accept a concurrency of 1', () => {
      Bus.configure().withConcurrency(1)
    })

    it('should accept a concurrency > 1', () => {
      Bus.configure().withConcurrency(10)
    })

    it('should throw an error when concurrency < 1', () => {
      expect(() => Bus.configure().withConcurrency(0)).toThrowError()
    })
  })

  describe('when disposing the bus', () => {
    describe('after its been initialized', () => {
      it('should dispose', async () => {
        await Bus.configure().initialize()
        await Bus.dispose()
      })
    })

    describe('when it hasn\'t been initialized', () => {
      it('should ignore the request', async () => {
        await expect(Bus.dispose()).resolves.toBeUndefined()
      })
    })
  })
})
