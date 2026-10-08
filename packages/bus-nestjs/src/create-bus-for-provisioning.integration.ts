import 'reflect-metadata'

import { DynamicModule } from '@nestjs/common'
import { BusInstance, BusState, ProvisioningPlan } from '@node-ts/bus-core'
import { BusModule } from './bus-module'
import { createBusForProvisioning } from './create-bus-for-provisioning'
import {
  ChargeCreditCard,
  ChargeCreditCardHandler,
  ProvisionedQueue,
  messageTypes,
  recorderModule,
  testLogger
} from './test'

class AppModule {}

/**
 * The application's root module, with a bus that handles `ChargeCreditCard`
 */
const appModule = (queue: ProvisionedQueue): DynamicModule => ({
  module: AppModule,
  imports: [
    recorderModule(),
    BusModule.forRoot({
      configure: configuration =>
        configuration.withTransport(queue).withMessageTypes(messageTypes)
    })
  ],
  providers: [ChargeCreditCardHandler]
})

describe('createBusForProvisioning', () => {
  describe('when given the application module', () => {
    const queue = new ProvisionedQueue()
    let bus: BusInstance
    let plans: ProvisioningPlan[]

    beforeAll(async () => {
      bus = await createBusForProvisioning(appModule(queue), {
        logger: testLogger()
      })
      plans = await bus.provision()
      await bus.dispose()
    })

    it('should return the bus built but not initialized or started', () => {
      expect(bus).toBeInstanceOf(BusInstance)
      expect(bus.state).toEqual(BusState.Stopped)
      expect(queue.calls).toEqual(['provision', 'dispose'])
    })

    it('should provision for the handlers registered in the application', () => {
      expect(plans).toEqual([
        {
          adapter: 'ProvisionedQueue',
          resources: expect.arrayContaining([
            { type: 'topic', name: ChargeCreditCard.NAME }
          ])
        }
      ])
    })
  })
})
