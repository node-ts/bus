import {
  Bus,
  BusMiddleware,
  Middleware,
  OutgoingContext
} from '@node-ts/bus-core'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { deepStrictEqual } from 'node:assert'
import { AsyncLocalStorage } from 'node:async_hooks'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import { ReserveRoom, RoomReserved } from './messages'
import { auditLog } from './services'

// #region register
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(reserveRoomHandler)
  .withMiddleware({
    incoming: async (context, next) => {
      console.log('Received', context.message.$name)
      // Runs the next middleware, and then the handlers
      await next()
    },
    handler: async (context, next) => {
      console.log('Calling', context.handlerName)
      await next()
    },
    outgoing: async (context, next) => {
      // kind is 'send', 'publish' or 'reply'
      console.log('Dispatching', {
        kind: context.kind,
        messageName: context.message.$name
      })
      await next()
    }
  })
  .build()
// #endregion register

// #region timing
const timeMessages: BusMiddleware = {
  incoming: async (context, next) => {
    const start = performance.now()
    await next()
    console.log('Message handled', {
      messageName: context.message.$name,
      durationMs: Math.round(performance.now() - start)
    })
  }
}

Bus.configure().withMessageTypes(messageTypes).withMiddleware(timeMessages)
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

Bus.configure().withMiddleware({
  incoming: async (context, next) =>
    logContext.run(
      {
        correlationId: context.correlationId,
        messageName: context.message.$name
      },
      next
    )
})
// #endregion log-context

// #region logging-failures
Bus.configure().withMiddleware({
  incoming: async (context, next) => {
    try {
      await next()
    } catch (error) {
      console.error('Failed to handle message', {
        messageName: context.message.$name,
        correlationId: context.correlationId,
        error
      })
      // Rethrow so the recoverability policy still retries or dead-letters the message
      throw error
    }
  }
})
// #endregion logging-failures

// #region validation
Bus.configure().withMiddleware({
  incoming: async (context, next) => {
    const { message } = context
    if (message instanceof ReserveRoom && !message.bookingId) {
      // Retrying can't fix it, so send it straight to the dead letter queue
      await context.failMessage()
      // Not calling next() skips the handlers
      return
    }
    await next()
  }
})
// #endregion validation

// #region audit
Bus.configure().withMiddleware({
  incoming: async (context, next) => {
    // Throws if the handlers fail, so a message is only audited once it's handled
    await next()
    try {
      await auditLog.write({
        messageName: context.message.$name,
        messageId: context.attributes.messageId,
        correlationId: context.correlationId,
        message: context.message,
        handledAt: new Date().toISOString()
      })
    } catch (error) {
      // The message was handled, so don't throw and have it retried
      console.error('Failed to audit message', { error })
    }
  }
})
// #endregion audit

// #region handler-timing
Bus.configure().withMiddleware({
  handler: async (context, next) => {
    const start = performance.now()
    await next()
    console.log('Handler finished', {
      handlerName: context.handlerName,
      durationMs: Math.round(performance.now() - start)
    })
  }
})
// #endregion handler-timing

// #region stamp-attribute
const stampService: Middleware<OutgoingContext> = async (context, next) => {
  context.attributes.attributes.sentBy = 'reservations-service'
  await next()
}

Bus.configure().withMiddleware({ outgoing: stampService })
// #endregion stamp-attribute

declare const rabbitMqTransport: RabbitMqTransport

// #region headers
Bus.configure()
  .withTransport(rabbitMqTransport)
  .withMiddleware({
    outgoing: async (context, next) => {
      // Written as an AMQP header, for consumers and broker plugins outside the bus
      context.headers['x-tenant'] = 'acme'
      await next()
    }
  })
// #endregion headers

// #region testing
// In a test, with any test runner
const context: OutgoingContext = {
  kind: 'publish',
  message: new RoomReserved('room-1', 'booking-1'),
  attributes: { attributes: {}, stickyAttributes: {} },
  headers: {}
}
let nextCalls = 0
await stampService(context, async () => {
  nextCalls++
})

deepStrictEqual(context.attributes.attributes, {
  sentBy: 'reservations-service'
})
deepStrictEqual(nextCalls, 1)
// #endregion testing

await bus.initialize()
