import { Message } from '@node-ts/bus-messages'

export class TestFailMessage extends Message {
  static NAME = '@node-ts/bus-sqs/test-fail-message'
  $name = TestFailMessage.NAME
  $version = 1

  constructor (
    readonly id: string
  ) {
    super()
  }
}
