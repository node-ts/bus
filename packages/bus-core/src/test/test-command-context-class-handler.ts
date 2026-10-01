import { MessageAttributes } from '@node-ts/bus-messages'
import { Handler, HandlerContext } from '../handler'
import { TestCommand2 } from './test-command-2'
import { TestEvent } from './test-event'

/**
 * A class handler with no dependencies that publishes through its context rather than an injected bus
 */
export class TestCommandContextClassHandler implements Handler<TestCommand2> {
  get messageType() {
    return TestCommand2
  }

  async handle(
    _message: TestCommand2,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ): Promise<void> {
    await ctx.publish(new TestEvent('from-class-handler'))
  }
}
