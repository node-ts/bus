import { Bus } from './bus'
import { BusAlreadyInitialized } from './error'
import { TestEvent } from '../test'
import { Persistence } from '../workflow'
import { Serializer } from '../serialization'
import { Logger } from '../logger'
import { Transport } from '../transport'

describe('Bus', () => {
  describe('when configuring Bus after initialization', () => {
    it('should reject', async () => {
      const config = Bus.configure()
      const bus = await config.initialize()
      expect(() => config.withHandler(TestEvent, () => undefined)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withLogger(() => ({} as Logger))).toThrowError(BusAlreadyInitialized)
      expect(() => config.withPersistence({} as Persistence)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withSerializer({} as Serializer)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withTransport({} as Transport)).toThrowError(BusAlreadyInitialized)
      expect(() => config.withWorkflow({} as any)).toThrowError(BusAlreadyInitialized)
      await bus.dispose()
    })
  })

  describe('when configuring bus concurrency', () => {
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
        const bus = await Bus.configure().initialize()
        await bus.dispose()
      })
    })
  })
})
