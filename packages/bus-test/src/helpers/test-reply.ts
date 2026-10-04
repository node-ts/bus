import { Event } from '@node-ts/bus-messages'

/**
 * The reply to `TestReplyRequest`. It's an event to show a reply can be one, though it's never published.
 */
export class TestReply extends Event {
  static NAME = '@node-ts/bus-test/test-reply'
  $name = TestReply.NAME
  $version = 0

  constructor(readonly id: string) {
    super()
  }
}
