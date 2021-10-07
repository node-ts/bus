import { Event } from '@node-ts/bus-messages'

export class FinalTask extends Event {
  static NAME = '@node-ts/bus-core/final-task'
  $name = FinalTask.NAME
  $version = 0
}
