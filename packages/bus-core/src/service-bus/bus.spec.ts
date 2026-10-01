import { It, Mock, Times } from 'typemoq'
import { ContainerAdapter } from '../container'
import { Logger } from '../logger'
import { Receiver } from '../receiver'
import { RetryStrategy } from '../retry-strategy'
import { Serializer } from '../serialization'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { InMemoryQueue, Transport } from '../transport'
import { sleep } from '../util'
import { Persistence } from '../workflow'
import { TestWorkflow } from '../workflow/test'
import { Bus } from './bus'
import { BusConfiguration } from './bus-configuration'
import { BusInstance } from './bus-instance'
import { BusState } from './bus-state'
import { BusAlreadyInitialized } from './error'

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
      ['withLogger', config => config.withLogger(() => ({}) as Logger)],
      ['withSerializer', config => config.withSerializer({} as Serializer)],
      [
        'withMessageTypes',
        config => config.withMessageTypes({ messages: {}, types: {} })
      ],
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
        expect(() => configure(sut)).toThrow(BusAlreadyInitialized)
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
      expect(() => Bus.configure().withConcurrency(0)).toThrow()
    })
  })

  describe('when registering the same workflow twice', () => {
    it('should throw', () => {
      expect(() =>
        Bus.configure().withWorkflow(TestWorkflow).withWorkflow(TestWorkflow)
      ).toThrow('Attempted to register two workflows with the same name')
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

  describe('when the bus fails to stop on an interrupt signal', () => {
    const logger = Mock.ofType<Logger>()
    const stopError = new Error('Transport failed to stop')
    let bus: BusInstance

    beforeAll(async () => {
      const transport: Transport = new InMemoryQueue()
      transport.stop = async () => {
        throw stopError
      }
      bus = Bus.configure()
        .withTransport(transport)
        .withLogger(() => logger.object)
        .build()
      await bus.initialize()
      await bus.start()
      process.emit('SIGINT')
      while (bus.state === BusState.Started) {
        await sleep(10)
      }
      await sleep(50)
    })

    afterAll(async () => bus.dispose())

    it('should log the error', () => {
      logger.verify(
        l =>
          l.error(
            'Failed to stop bus after an interrupt signal',
            It.isObjectWith({ signal: 'SIGINT' })
          ),
        Times.once()
      )
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
