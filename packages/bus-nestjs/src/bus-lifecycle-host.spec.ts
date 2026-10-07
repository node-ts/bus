import { DiscoveryService, ModuleRef } from '@nestjs/core'
import { BusConfiguration, BusInstance } from '@node-ts/bus-core'
import { It, Mock } from 'typemoq'
import { BusLifecycleHost } from './bus-lifecycle-host'
import { BusCoreVersionNotSupported } from './error'

describe('BusLifecycleHost', () => {
  describe('when the installed bus-core is too old to say whether a bus can start', () => {
    let error: unknown

    beforeAll(() => {
      const discovery = Mock.ofType<DiscoveryService>()
      discovery.setup(d => d.getProviders(It.isAny())).returns(() => [])
      const configuration = Mock.ofType<BusConfiguration>()
      configuration
        .setup(c => c.withContainer(It.isAny()))
        .returns(() => configuration.object)
      // A bus from a bus-core with no canStart
      configuration
        .setup(c => c.build())
        .returns(() => ({}) as unknown as BusInstance)
      const sut = new BusLifecycleHost(
        'default',
        configuration.object,
        'auto',
        false,
        discovery.object,
        Mock.ofType<ModuleRef>().object
      )
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
})
