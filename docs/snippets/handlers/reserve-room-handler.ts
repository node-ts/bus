import { handlerFor } from '@node-ts/bus-core'
import { ReserveRoom, RoomReserved } from '../messages'
import { reservationService } from '../services'

export const reserveRoomHandler = handlerFor(
  ReserveRoom,
  async (command, _attributes, ctx) => {
    await reservationService.reserveRoom(command.roomId, command.bookingId)
    // Published once the handler resolves, and dropped if it throws
    await ctx.publish(new RoomReserved(command.roomId, command.bookingId))
  }
)
