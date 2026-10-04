import { HandlerContext } from '@node-ts/bus-core'
import { Event, messageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual } from 'node:assert'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { ReserveRoom, RoomReserved } from './messages'

// In a test, with any test runner
const published: Event[] = []
const ctx: HandlerContext = {
  correlationId: 'test',
  send: async () => {},
  publish: async event => {
    published.push(event)
  },
  reply: async () => {},
  failMessage: async () => {},
  returnMessage: async () => {}
}

await reserveRoomHandler.messageHandler(
  new ReserveRoom('room-1', 'booking-1'),
  // Empty attributes and sticky attributes
  messageAttributes(),
  ctx
)

deepStrictEqual(published, [new RoomReserved('room-1', 'booking-1')])
