import { Event } from '@node-ts/bus-messages'

export class TestEvent extends Event {
  static NAME = '@node-ts/bus-core/test-event'
  $name = TestEvent.NAME
  $version = 1

  property1: string | undefined
  property2: string

  constructor(property1?: string) {
    super()
    this.property1 = property1
  }
}
