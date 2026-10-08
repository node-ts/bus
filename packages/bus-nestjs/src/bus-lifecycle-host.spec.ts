import { Logger } from '@nestjs/common'
import { DiscoveryService, ModuleRef } from '@nestjs/core'
import { BusConfiguration, BusInstance, BusState } from '@node-ts/bus-core'
import { It, Mock } from 'typemoq'
import { BusLifecycleHost } from './bus-lifecycle-host'
import { BusCoreVersionNotSupported } from './error'
import { RecordingLogger } from './test/recording-logger'

/**
 * Creates a host whose configuration builds `bus`, in an application with no handlers or workflows
 */
const createHost = (bus: object): BusLifecycleHost => {
  const discovery = Mock.ofType<DiscoveryService>()
  discovery.setup(d => d.getProviders(It.isAny())).returns(() => [])
  const configuration = Mock.ofType<BusConfiguration>()
  configuration
    .setup(c => c.withContainer(It.isAny()))
    .returns(() => configuration.object)
  configuration.setup(c => c.build()).returns(() => bus as BusInstance)
  return new BusLifecycleHost(
    'default',
    configuration.object,
    'auto',
    false,
    discovery.object,
    Mock.ofType<ModuleRef>().object
  )
}

describe('BusLifecycleHost', () => {
  describe('when the installed bus-core is too old to say whether a bus can start', () => {
    let error: unknown

    beforeAll(() => {
      // A bus from a bus-core with no canStart
      const sut = createHost({})
      try {
        sut.onModuleInit()
      } catch (e) {
        error = e
      }
    })

    it('should throw BusCoreVersionNotSupported, saying to upgrade it', () => {
      expect(error).toBeInstanceOf(BusCoreVersionNotSupported)
      expect((error as BusCoreVersionNotSupported).missing).toEqual(
        'BusInstance.canStart'
      )
      expect((error as BusCoreVersionNotSupported).help).toContain(
        'Upgrade @node-ts/bus-core'
      )
    })
  })

  describe('when the bus fails to initialize and then to dispose', () => {
    const initializeError = new Error('Connection refused')
    const disposeError = new Error('Connection already closed')
    const logger = new RecordingLogger()
    const bus = {
      canStart: true,
      state: BusState.Stopped,
      disposeCalls: 0,
      async initialize(): Promise<void> {
        throw initializeError
      },
      async start(): Promise<void> {},
      async dispose(): Promise<void> {
        bus.disposeCalls++
        throw disposeError
      }
    }
    let error: unknown

    beforeAll(async () => {
      Logger.overrideLogger(logger)
      const sut = createHost(bus)
      sut.onModuleInit()
      try {
        await sut.onApplicationBootstrap()
      } catch (e) {
        error = e
      }
      // Nest doesn't run the shutdown hooks of an application that failed to start, but the bus mustn't be
      // disposed twice if it does
      await sut.onApplicationShutdown()
    })

    it('should rethrow the error the bus failed to initialize with', () => {
      expect(error).toBe(initializeError)
    })

    it('should dispose the bus once', () => {
      expect(bus.disposeCalls).toEqual(1)
    })

    it('should log the error the bus failed to dispose with', () => {
      expect(logger.calls).toContainEqual([
        'error',
        'Failed to dispose the bus after it failed to start',
        {
          bus: 'default',
          error: expect.objectContaining({ message: disposeError.message })
        },
        '@node-ts/bus-nestjs:bus-lifecycle-host'
      ])
    })
  })
})
