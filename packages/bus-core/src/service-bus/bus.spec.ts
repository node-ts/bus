import { Logger } from '../logger'
import { Serializer } from '../serialization'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { Transport } from '../transport'
import { Persistence } from '../workflow'
import { Bus } from './bus'
import { BusAlreadyInitialized } from './error'
import { BusState } from './bus-state'
import { BusInstance } from './bus-instance'
import { sleep } from '../util'
import { Mock } from 'typemoq'
import { BusConfiguration } from './bus-configuration'
import { ContainerAdapter } from '../container'
import { RetryStrategy } from '../retry-strategy'
import { Receiver } from '../receiver'

describe('Bus', () => {
  describe('when configuring Bus after initialization', () => {
    let sut: BusConfiguration
    let bus: BusInstance

    beforeAll(() => {
      sut = Bus.configure().withLogger(() => Mock.ofType<Logger>().object)
      bus = sut.build()
    })

    afterAll(async () => bus.dispose())

    const configurationCalls: [string, (config: BusConfiguration) => void][] = [
      ['asSendOnly', config => config.asSendOnly()],
      ['withHandler', config => config.withHandler(TestEventClassHandler)],
      [
        'withCustomHandler',
        config =>
          config.withCustomHandler(() => undefined, {
            resolveWith: () => true
          })
      ],
      ['withWorkflow', config => config.withWorkflow({} as any)],
      ['withTransport', config => config.withTransport({} as Transport)],
      ['withLogger', config => config.withLogger(() => ({} as Logger))],
      ['withSerializer', config => config.withSerializer({} as Serializer)],
      ['withPersistence', config => config.withPersistence({} as Persistence)],
      ['withConcurrency', config => config.withConcurrency(2)],
      ['withContainer', config => config.withContainer({} as ContainerAdapter)],
      [
        'withMessageReadMiddleware',
        config => config.withMessageReadMiddleware((_, next) => next())
      ],
      [
        'withRetryStrategy',
        config => config.withRetryStrategy({} as RetryStrategy)
      ],
      [
        'withAdditionalInterruptSignal',
        config => config.withAdditionalInterruptSignal('SIGUSR2')
      ],
      ['withReceiver', config => config.withReceiver({} as Receiver)]
    ]

    it.each(configurationCalls)(
      'should reject %s with BusAlreadyInitialized',
      (_, configure) => {
        expect(() => configure(sut)).toThrowError(BusAlreadyInitialized)
      }
    )
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
    const waitForStopped = async (bus: BusInstance) => {
      while (bus.state !== BusState.Stopped) {
        await sleep(10)
      }
    }

    it('should stop the bus on SIGINT', async () => {
      const bus = Bus.configure().build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGINT')
      expect(bus.state).toBe(BusState.Stopping)
      await waitForStopped(bus)
      await bus.dispose()
    })

    it('should stop the bus on SIGTERM', async () => {
      const bus = Bus.configure().build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGTERM')
      expect(bus.state).toBe(BusState.Stopping)
      await waitForStopped(bus)
      await bus.dispose()
    })

    it('should stop the bus on user provided interrupts', async () => {
      const additionalInterrupts: NodeJS.Signals[] = ['SIGUSR2']
      const bus = Bus.configure()
        .withAdditionalInterruptSignal(...additionalInterrupts)
        .build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGUSR2')
      expect(bus.state).toBe(BusState.Stopping)
      await waitForStopped(bus)
      await bus.dispose()
    })
  })

  describe('when several bus instances are initialized', () => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
    const busCount = 3
    let listenersBefore: number[]
    let listenersWhileInitialized: number[]
    let listenersAfterDispose: number[]

    const countListeners = () =>
      signals.map(signal => process.listenerCount(signal))

    beforeAll(async () => {
      listenersBefore = countListeners()
      const buses = new Array(busCount).fill(undefined).map(() =>
        Bus.configure()
          .withLogger(() => Mock.ofType<Logger>().object)
          .build()
      )
      for (const bus of buses) {
        await bus.initialize()
      }
      listenersWhileInitialized = countListeners()
      for (const bus of buses) {
        await bus.dispose()
      }
      listenersAfterDispose = countListeners()
    })

    it('should register one listener per signal for each instance', () => {
      expect(listenersWhileInitialized).toEqual(
        listenersBefore.map(count => count + busCount)
      )
    })

    it('should remove the listeners when each instance is disposed', () => {
      expect(listenersAfterDispose).toEqual(listenersBefore)
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
