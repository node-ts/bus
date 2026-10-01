import { handlerFor } from '../handler'
import { TestCommand } from './test-command'
import { TestEvent } from './test-event'

/**
 * A function handler that publishes through its context rather than a captured bus
 */
export const testCommandContextHandler = handlerFor(
  TestCommand,
  async (_message, _attributes, ctx) => {
    await ctx.publish(new TestEvent(ctx.correlationId))
  }
)
