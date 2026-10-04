import { Command } from '@node-ts/bus-messages'

/**
 * A request that the transport suite's handler answers with `TestReply`, using `ctx.reply()`
 */
export class TestReplyRequest extends Command {
  static NAME = '@node-ts/bus-test/test-reply-request'
  $name = TestReplyRequest.NAME
  $version = 0

  constructor(readonly id: string) {
    super()
  }
}
