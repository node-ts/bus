import { Bus, Middleware, TransportMessage } from '@node-ts/bus-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import { messageTypes } from './message-types.generated'

// #region timing
const timeMessages: Middleware<TransportMessage<unknown>> = async (
  message,
  next
) => {
  const start = performance.now()
  // Dispatches the message to the next middleware, and then its handlers
  await next()
  console.log('Message handled', {
    messageName: message.domainMessage.$name,
    durationMs: Math.round(performance.now() - start)
  })
}

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withMessageReadMiddleware(timeMessages)
  .build()
// #endregion timing

// #region log-context
interface LogContext {
  correlationId: string | undefined
  messageName: string
}

/**
 * Holds the context of the message being handled, for the logger to add to
 * every log written while handling it
 */
export const logContext = new AsyncLocalStorage<LogContext>()

Bus.configure().withMessageReadMiddleware(async (message, next) =>
  logContext.run(
    {
      correlationId: message.attributes.correlationId,
      messageName: message.domainMessage.$name
    },
    next
  )
)
// #endregion log-context

await bus.initialize()
