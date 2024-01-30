import { Logger } from '../logger'
import { Serializer } from '../serialization'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { Transport } from '../transport'
import { Persistence } from '../workflow'
import { Bus } from './bus'
import { BusAlreadyInitialized } from './error'
import { BusState } from './bus-state'

describe('Bus', () => {
  describe('when configuring Bus after initialization', () => {
    it('should reject', async () => {
      const config = Bus.configure()
      const bus = config.build()
      expect(() => config.withHandler(TestEventClassHandler)).toThrowError(
        BusAlreadyInitialized
      )
      expect(() => config.withLogger(() => ({} as Logger))).toThrowError(
        BusAlreadyInitialized
      )
      expect(() => config.withPersistence({} as Persistence)).toThrowError(
        BusAlreadyInitialized
      )
      expect(() => config.withSerializer({} as Serializer)).toThrowError(
        BusAlreadyInitialized
      )
      expect(() => config.withTransport({} as Transport)).toThrowError(
        BusAlreadyInitialized
      )
      expect(() => config.withWorkflow({} as any)).toThrowError(
        BusAlreadyInitialized
      )
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

  describe('when interrupt signals are sent', () => {
    it('should stop the bus on SIGINT', async () => {
      const bus = Bus.configure().build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGINT')
      expect(bus.state).toBe(BusState.Stopped)
    })

    it('should stop the bus on SIGTERM', async () => {
      const bus = Bus.configure().build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGTERM')
      expect(bus.state).toBe(BusState.Stopped)
    })

    it('should stop the bus on user provided interrupts', async () => {
      const additionalInterrupts: NodeJS.Signals[] = ['SIGUSR2']
      const bus = Bus.configure()
        .withAdditionalInterruptSignal(...additionalInterrupts)
        .build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGUSR2')
      expect(bus.state).toBe(BusState.Stopped)
    })
  })

  describe('when disposing the bus', () => {
    describe('after its been initialized', () => {
      it('should dispose', async () => {
        const bus = Bus.configure().build()
        await bus.initialize()
        await bus.dispose()
      })
    })
  })
})
