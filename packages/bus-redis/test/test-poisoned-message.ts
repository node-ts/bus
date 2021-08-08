import { Message } from '@node-ts/bus-messages'

export class TestPoisonedMessage extends Message {
  static NAME = '@node-ts/bus-core/test-poisoned-message'
  $name = TestPoisonedMessage.NAME
  $version = 1

  constructor (
    readonly id: string
  ) {
    super()
  }
}
