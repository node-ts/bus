import { Event } from '@node-ts/bus-messages'

export class TestEvent2 extends Event {
  static NAME = '@node-ts/bus-core/test-event-2'
  $name = TestEvent2.NAME
  $version = 1
}
