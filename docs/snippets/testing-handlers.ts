import { handlerContext } from '@node-ts/bus-core'
import { messageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual } from 'node:assert'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { ReserveRoom, RoomReserved } from './messages'

// In a test, with any test runner. The context records what the handler
// sends and publishes, and sends nothing
const ctx = handlerContext()

await reserveRoomHandler.messageHandler(
  new ReserveRoom('room-1', 'booking-1'),
  // Empty attributes and sticky attributes
  messageAttributes(),
  ctx
)

deepStrictEqual(ctx.published, [
  { message: new RoomReserved('room-1', 'booking-1'), options: {} }
])
