import { Bus } from '@node-ts/bus-core'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import { ReserveRoom } from './messages'

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(reserveRoomHandler)
  .build()

await bus.initialize()
// Start the bus to begin handling messages
await bus.start()

await bus.send(
  new ReserveRoom(
    '63a65cf0-d239-4b83-96da-f33f013db23a',
    '12b85a56-e929-47a8-9ac3-e87739d5d215'
  )
)
