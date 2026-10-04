import {
  HandlerDispatchRejected,
  HandlerInvocationContext,
  IncomingContext,
  OutgoingContext,
  OutgoingMessageDropped,
  OutgoingMessageDropReason,
  RequestedSettlement
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { openTelemetry } from './open-telemetry'
import {
  TestTelemetry,
  TracedCommand,
  TracedEvent,
  useContextManager
} from './test'

class InventoryUnavailable extends Error {}

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

/**
 * The context of sending a command, or of publishing an event
 */
const outgoingContext = (
  attributes: MessageAttributes,
  message: TracedCommand | TracedEvent = new TracedCommand('unit'),
  dispatched: Promise<void> = Promise.resolve()
): OutgoingContext =>
  message instanceof TracedEvent
    ? { kind: 'publish', message, attributes, headers: {}, dispatched }
    : { kind: 'send', message, attributes, headers: {}, dispatched }

/**
 * A `dispatched` promise that has rejected, as the bus gives one when a message isn't sent
 */
const rejected = (error: unknown): Promise<void> => {
  const promise = Promise.reject(error)
  // The middleware handles it; this stops Node reporting it before then
  void promise.catch(() => undefined)
  return promise
}

/**
 * Lets the middleware's handlers of `dispatched` run
 */
const settle = async (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve))

const incomingContext = (
  attributes: MessageAttributes,
  requested?: RequestedSettlement
): IncomingContext => {
  const message = new TracedCommand('unit')
  return {
    message,
    attributes,
    transportMessage: {
      id: 'transport-message',
      domainMessage: message,
      raw: message,
      attributes,
      failedAttempts: 0
    },
    correlationId: attributes.correlationId,
    send: async () => undefined,
    publish: async () => undefined,
    reply: async () => undefined,
    failMessage: async () => undefined,
    returnMessage: async () => undefined,
    requestedSettlement: () => requested
  }
}

const handlerContext = (
  attributes: MessageAttributes
): HandlerInvocationContext => ({
  ...incomingContext(attributes),
  handlerName: 'reserveRoom'
})

/**
 * Calls a middleware stage with a `next` that runs `then`
 */
const run = async <TContext>(
  middleware:
    | ((context: TContext, next: () => Promise<void>) => Promise<void>)
    | undefined,
  context: TContext,
  then: () => Promise<void> = async () => undefined
): Promise<void> => middleware!(context, then)

describe('openTelemetry', () => {
  let disableContextManager: () => void
  beforeAll(() => {
    disableContextManager = useContextManager()
  })
  afterAll(() => disableContextManager())

  describe('when a message is sent with attributes that already carry a trace context', () => {
    const telemetry = new TestTelemetry()
    const callerAttributes: MessageAttributes = {
      attributes: {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        tracestate: 'stale=1',
        tenantId: 'acme'
      },
      stickyAttributes: {},
      messageId: 'message-1',
      correlationId: 'conversation-1'
    }
    let context: OutgoingContext

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      context = outgoingContext(callerAttributes)
      await run(sut.outgoing, context)
    })

    it('should replace the trace context with the send span', () => {
      const span = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(context.attributes.attributes.traceparent).toEqual(
        `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`
      )
      expect(context.attributes.attributes.tracestate).toBeUndefined()
    })

    it('should keep the other attributes', () => {
      expect(context.attributes.attributes.tenantId).toEqual('acme')
      expect(context.attributes.messageId).toEqual('message-1')
      expect(context.attributes.correlationId).toEqual('conversation-1')
    })

    it("should not change the caller's attributes", () => {
      expect(callerAttributes.attributes.traceparent).toEqual(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      )
      expect(callerAttributes.attributes.tracestate).toEqual('stale=1')
    })

    it('should record a producer span with the semantic convention attributes', () => {
      const span = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(span.kind).toEqual(SpanKind.PRODUCER)
      expect(span.parentSpanContext).toBeUndefined()
      expect(span.attributes).toEqual({
        'messaging.system': 'node_ts_bus',
        'messaging.operation.name': 'send',
        'messaging.operation.type': 'send',
        'messaging.destination.name': TracedCommand.NAME,
        'messaging.message.id': 'message-1',
        'messaging.message.conversation_id': 'conversation-1',
        'node_ts_bus.message.name': TracedCommand.NAME
      })
    })

    it('should count the message as sent', async () => {
      expect(await telemetry.metric('messaging.client.sent.messages')).toEqual([
        {
          attributes: {
            'messaging.system': 'node_ts_bus',
            'messaging.operation.name': 'send',
            'messaging.operation.type': 'send',
            'messaging.destination.name': TracedCommand.NAME,
            'node_ts_bus.message.name': TracedCommand.NAME
          },
          value: 1
        }
      ])
    })
  })

  describe('when sending fails', () => {
    const telemetry = new TestTelemetry()
    const transportError = new InventoryUnavailable('broker unavailable')
    let sendError: unknown

    beforeAll(async () => {
      const sut = openTelemetry(
        telemetry.options({ messagingSystem: 'rabbitmq' })
      )
      sendError = await run(
        sut.outgoing,
        outgoingContext(
          { attributes: {}, stickyAttributes: {} },
          new TracedCommand('unit'),
          rejected(transportError)
        ),
        async () => {
          throw transportError
        }
      ).catch((error: unknown) => error)
      await settle()
    })

    it('should rethrow the error', () => {
      expect(sendError).toBe(transportError)
    })

    it('should record the error on the send span', () => {
      const span = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(span.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'broker unavailable'
      })
      expect(span.attributes['error.type']).toEqual('InventoryUnavailable')
      expect(span.events.map(event => event.name)).toEqual(['exception'])
    })

    it('should count the send with its error type', async () => {
      const [point] = await telemetry.metric('messaging.client.sent.messages')
      expect(point.attributes).toMatchObject({
        'messaging.system': 'rabbitmq',
        'error.type': 'InventoryUnavailable'
      })
    })
  })

  describe('when a handler sends a message that the bus then drops', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      const attributes: MessageAttributes = {
        attributes: {},
        stickyAttributes: {}
      }
      await run(sut.handler, handlerContext(attributes), async () => {
        await run(
          sut.outgoing,
          outgoingContext(
            attributes,
            new TracedEvent('unit'),
            rejected(
              new OutgoingMessageDropped(
                TracedEvent.NAME,
                OutgoingMessageDropReason.HandlerFailed
              )
            )
          )
        )
        throw new InventoryUnavailable('no rooms')
      }).catch(() => undefined)
      await settle()
    })

    it('should not count the message as sent', async () => {
      expect(await telemetry.metric('messaging.client.sent.messages')).toEqual(
        []
      )
    })

    it('should mark the publish span with why it was dropped, without an error status', () => {
      const span = telemetry.span(`publish ${TracedEvent.NAME}`)
      expect(span.attributes['node_ts_bus.dropped.reason']).toEqual(
        'handler-failed'
      )
      expect(span.status.code).toEqual(SpanStatusCode.UNSET)
      expect(span.attributes['error.type']).toBeUndefined()
    })

    it('should record the error on the handler span', () => {
      const span = telemetry.span('reserveRoom')
      expect(span.kind).toEqual(SpanKind.INTERNAL)
      expect(span.status.code).toEqual(SpanStatusCode.ERROR)
      expect(span.attributes['error.type']).toEqual('InventoryUnavailable')
    })

    it('should start the publish span inside the handler span', () => {
      const handlerSpan = telemetry.span('reserveRoom')
      const sendSpan = telemetry.span(`publish ${TracedEvent.NAME}`)
      expect(sendSpan.parentSpanContext?.spanId).toEqual(
        handlerSpan.spanContext().spanId
      )
    })
  })

  describe('when a message has been buffered but not sent yet', () => {
    const telemetry = new TestTelemetry()
    const dispatched = Promise.withResolvers<void>()
    let spansBeforeSending: string[]
    let sentBeforeSending: unknown[]

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      await run(
        sut.outgoing,
        outgoingContext(
          { attributes: {}, stickyAttributes: {} },
          new TracedEvent('unit'),
          dispatched.promise
        )
      )
      await settle()
      spansBeforeSending = telemetry.spans().map(span => span.name)
      sentBeforeSending = await telemetry.metric(
        'messaging.client.sent.messages'
      )

      dispatched.resolve()
      await settle()
    })

    it('should not end the span or count the message until it is sent', () => {
      expect(spansBeforeSending).toEqual([])
      expect(sentBeforeSending).toEqual([])
    })

    it('should end the span and count the message once it is sent', async () => {
      expect(telemetry.span(`publish ${TracedEvent.NAME}`).status.code).toEqual(
        SpanStatusCode.UNSET
      )
      const points = await telemetry.metric('messaging.client.sent.messages')
      expect(points.map(point => point.value)).toEqual([1])
    })
  })

  describe('when a received message carries a trace context and a sent time', () => {
    const telemetry = new TestTelemetry()
    const traceId = '0af7651916cd43dd8448eb211c80319c'
    const sendSpanId = 'b7ad6b7169203331'

    beforeAll(async () => {
      const sut = openTelemetry(
        telemetry.options({ endpointName: 'reservations-service' })
      )
      await run(
        sut.incoming,
        incomingContext({
          attributes: { traceparent: `00-${traceId}-${sendSpanId}-01` },
          stickyAttributes: {},
          messageId: 'message-1',
          sentAt: new Date(Date.now() - 2000).toISOString()
        })
      )
    })

    it('should record a consumer span that continues the trace', () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.kind).toEqual(SpanKind.CONSUMER)
      expect(span.spanContext().traceId).toEqual(traceId)
      expect(span.parentSpanContext?.spanId).toEqual(sendSpanId)
      expect(span.attributes).toEqual({
        'messaging.system': 'node_ts_bus',
        'messaging.operation.name': 'process',
        'messaging.operation.type': 'process',
        'messaging.destination.name': 'reservations-service',
        'messaging.message.id': 'message-1',
        'node_ts_bus.message.name': TracedCommand.NAME,
        'node_ts_bus.message.failed_attempts': 0
      })
    })

    it('should record the critical time from when it was sent', async () => {
      const [point] = await telemetry.metric('node_ts_bus.critical_time')
      expect(point.value).toEqual(1)
      expect(point.sum).toBeGreaterThanOrEqual(2)
      expect(point.sum).toBeLessThan(10)
    })

    it('should count it as consumed', async () => {
      const [point] = await telemetry.metric(
        'messaging.client.consumed.messages'
      )
      expect(point).toEqual({
        attributes: {
          'messaging.system': 'node_ts_bus',
          'messaging.operation.name': 'process',
          'messaging.operation.type': 'process',
          'messaging.destination.name': 'reservations-service',
          'node_ts_bus.message.name': TracedCommand.NAME
        },
        value: 1
      })
    })
  })

  describe('when a received message has no trace context or sent time', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      await run(
        sut.incoming,
        incomingContext({ attributes: {}, stickyAttributes: {} })
      )
    })

    it('should start a new trace', () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.parentSpanContext).toBeUndefined()
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/)
    })

    it('should not record a critical time', async () => {
      expect(await telemetry.metric('node_ts_bus.critical_time')).toEqual([])
    })
  })

  describe('when one handler fails a received message', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      await run(
        sut.incoming,
        incomingContext({
          attributes: {},
          stickyAttributes: {},
          sentAt: new Date().toISOString()
        }),
        async () => {
          throw new HandlerDispatchRejected([
            new InventoryUnavailable('no rooms')
          ])
        }
      ).catch(() => undefined)
    })

    it("should use the handler's error as the error type", () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.status.code).toEqual(SpanStatusCode.ERROR)
      expect(span.attributes['error.type']).toEqual('InventoryUnavailable')
    })

    it('should count it as failed', async () => {
      const [point] = await telemetry.metric('node_ts_bus.failed.messages')
      expect(point.value).toEqual(1)
      expect(point.attributes['error.type']).toEqual('InventoryUnavailable')
    })

    it('should record the process duration with the error type', async () => {
      const [point] = await telemetry.metric('messaging.process.duration')
      expect(point.value).toEqual(1)
      expect(point.attributes['error.type']).toEqual('InventoryUnavailable')
    })

    it('should not record a critical time', async () => {
      expect(await telemetry.metric('node_ts_bus.critical_time')).toEqual([])
    })
  })

  describe.each([
    {
      requested: RequestedSettlement.Failed,
      errorType: 'FailMessageRequested'
    },
    {
      requested: RequestedSettlement.Returned,
      errorType: 'ReturnMessageRequested'
    }
  ])(
    'when a handler asks for a received message to be $requested',
    ({ requested, errorType }) => {
      const telemetry = new TestTelemetry()

      beforeAll(async () => {
        const sut = openTelemetry(telemetry.options())
        await run(
          sut.incoming,
          incomingContext(
            {
              attributes: {},
              stickyAttributes: {},
              sentAt: new Date().toISOString()
            },
            requested
          )
        )
      })

      it('should set an error status and error type on the process span', () => {
        const span = telemetry.span(`process ${TracedCommand.NAME}`)
        expect(span.status.code).toEqual(SpanStatusCode.ERROR)
        expect(span.attributes['error.type']).toEqual(errorType)
      })

      it('should count it as failed', async () => {
        const [point] = await telemetry.metric('node_ts_bus.failed.messages')
        expect(point.value).toEqual(1)
        expect(point.attributes['error.type']).toEqual(errorType)
      })

      it('should record the process duration with the error type', async () => {
        const [point] = await telemetry.metric('messaging.process.duration')
        expect(point.attributes['error.type']).toEqual(errorType)
      })

      it('should not record a critical time', async () => {
        expect(await telemetry.metric('node_ts_bus.critical_time')).toEqual([])
      })
    }
  )

  describe('when a send is rejected before it reaches the transport', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      const validationError = new InventoryUnavailable('invalid')
      await run(
        sut.outgoing,
        outgoingContext(
          { attributes: {}, stickyAttributes: {} },
          new TracedCommand('unit'),
          rejected(
            new OutgoingMessageDropped(
              TracedCommand.NAME,
              OutgoingMessageDropReason.Rejected,
              validationError
            )
          )
        ),
        async () => {
          throw validationError
        }
      ).catch(() => undefined)
      await settle()
    })

    it('should mark the send span as rejected, with the error that rejected it', () => {
      const span = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(span.attributes['node_ts_bus.dropped.reason']).toEqual('rejected')
      expect(span.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'invalid'
      })
      expect(span.attributes['error.type']).toEqual('InventoryUnavailable')
      expect(span.events.map(event => event.name)).toEqual(['exception'])
    })

    it('should not count it as sent', async () => {
      expect(await telemetry.metric('messaging.client.sent.messages')).toEqual(
        []
      )
    })
  })

  describe('when several handlers fail a received message', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      await run(
        sut.incoming,
        incomingContext({ attributes: {}, stickyAttributes: {} }),
        async () => {
          throw new HandlerDispatchRejected([
            new InventoryUnavailable('no rooms'),
            new Error('timeout')
          ])
        }
      ).catch(() => undefined)
    })

    it('should use the error the bus wraps them in as the error type', () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.attributes['error.type']).toEqual('HandlerDispatchRejected')
    })
  })

  describe('when something other than an error is thrown', () => {
    const telemetry = new TestTelemetry()

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      await run(
        sut.incoming,
        incomingContext({ attributes: {}, stickyAttributes: {} }),
        async () => {
          throw 'not an error'
        }
      ).catch(() => undefined)
    })

    it('should use _OTHER as the error type', () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.attributes['error.type']).toEqual('_OTHER')
    })
  })

  describe('when the trace context is written', () => {
    const telemetry = new TestTelemetry()
    let context: OutgoingContext

    beforeAll(async () => {
      const sut = openTelemetry(telemetry.options())
      context = outgoingContext({ attributes: {}, stickyAttributes: {} })
      await run(sut.outgoing, context)
    })

    it('should be a W3C traceparent in the attributes', () => {
      expect(context.attributes.attributes.traceparent).toMatch(TRACEPARENT)
    })

    it('should not set transport headers', () => {
      expect(context.headers).toEqual({})
    })
  })
})
