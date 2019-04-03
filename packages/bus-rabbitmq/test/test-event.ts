import { Event } from '@node-ts/bus-messages'

export class TestEvent extends Event {
  static NAME = '@node-ts/bus-core/test-event'
  $name = TestEvent.NAME
  $version = 1
}
