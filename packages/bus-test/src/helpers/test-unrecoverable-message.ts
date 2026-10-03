import { Message } from '@node-ts/bus-messages'

/**
 * A message whose handler always throws a `TestUnrecoverableError`, which the transport tests' recoverability policy
 * lists as unrecoverable
 */
export class TestUnrecoverableMessage extends Message {
  static NAME = '@node-ts/bus-test/test-unrecoverable-message'
  $name = TestUnrecoverableMessage.NAME
  $version = 1

  constructor(readonly id: string) {
    super()
  }
}
