import { Bus, BusInstance, Logger, Transport } from '@node-ts/bus-core'
import { Mock } from 'typemoq'
import { messageTypes } from './helpers'
import {
  messageRoundTripCases,
  RoundTripReceiver
} from './message-round-trip-cases'

/**
 * A suite that sends messages with nested types (Dates, class instances several levels deep,
 * arrays, Maps, Sets, optional and null fields) through a transport and checks they arrive at
 * the handler with their types restored and their attributes intact. `transportTests` already
 * runs these cases, so use this on its own only when the full suite doesn't apply.
 * @param transport A fully configured transport that's the subject under test. It must
 * (de)serialize messages through `coreDependencies.messageSerializer`.
 */
export const messageRoundTripTests = (transport: Transport): void => {
  const receiver = new RoundTripReceiver()
  let bus: BusInstance

  describe('when messages make a round trip through the transport', () => {
    beforeAll(async () => {
      bus = receiver
        .withHandlers(Bus.configure())
        .withMessageTypes(messageTypes)
        .withTransport(transport)
        .withLogger(() => Mock.ofType<Logger>().object)
        .build()
      await bus.provision()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    messageRoundTripCases(() => bus, receiver)
  })
}
