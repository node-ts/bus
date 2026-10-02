import { Command, Event } from '@node-ts/bus-messages'

export class ReserveRoom extends Command {
  static NAME = 'reservations/reserve-room'
  $name = ReserveRoom.NAME
  $version = 0

  constructor(
    readonly roomId: string,
    readonly bookingId: string
  ) {
    super()
  }
}

export class RoomReserved extends Event {
  static NAME = 'reservations/room-reserved'
  $name = RoomReserved.NAME
  $version = 0

  constructor(
    readonly roomId: string,
    readonly bookingId: string
  ) {
    super()
  }
}
