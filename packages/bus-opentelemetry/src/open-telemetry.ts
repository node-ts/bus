import {
  BusMiddleware,
  HandlerDispatchRejected,
  OutgoingMessageDropped
} from '@node-ts/bus-core'
import {
  Attributes,
  context,
  Context,
  Counter,
  defaultTextMapSetter,
  Histogram,
  metrics,
  propagation,
  Span,
  SpanKind,
  SpanStatusCode,
  TextMapGetter,
  trace,
  Tracer
} from '@opentelemetry/api'
import { OpenTelemetryOptions } from './open-telemetry-options'
import {
  ATTR_DROPPED_REASON,
  ATTR_ERROR_TYPE,
  ATTR_HANDLER_NAME,
  ATTR_MESSAGE_NAME,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_CONVERSATION_ID,
  ATTR_MESSAGING_MESSAGE_ID,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_SYSTEM,
  DEFAULT_MESSAGING_SYSTEM,
  ERROR_TYPE_VALUE_OTHER,
  INSTRUMENTATION_SCOPE,
  METRIC_CRITICAL_TIME,
  METRIC_FAILED_MESSAGES,
  METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES,
  METRIC_MESSAGING_CLIENT_SENT_MESSAGES,
  METRIC_MESSAGING_PROCESS_DURATION,
  OPERATION_PROCESS,
  OPERATION_TYPE_SEND,
  SCHEMA_URL
} from './semantic-conventions'

/**
 * The bucket boundaries, in seconds, the messaging conventions recommend for their duration histograms
 */
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10
]

/**
 * Critical time includes the time a message waited in the queue, which can be minutes when a service is behind
 */
const CRITICAL_TIME_BUCKETS = [
  ...DURATION_BUCKETS,
  30,
  60,
  120,
  300,
  600,
  1800,
  3600
]

const MILLISECONDS_IN_SECOND = 1000

/**
 * The tracer and metric instruments of one `openTelemetry()` middleware
 */
interface Instruments {
  tracer: Tracer
  sentMessages: Counter
  consumedMessages: Counter
  failedMessages: Counter
  processDuration: Histogram
  criticalTime: Histogram
}

/**
 * Reads the trace context from a received message's attributes
 */
const attributesGetter: TextMapGetter<Record<string, unknown>> = {
  keys: carrier => Object.keys(carrier),
  get: (carrier, key) => {
    const value = carrier[key]
    return typeof value === 'string' ? value : undefined
  }
}

/**
 * Leaves out attributes whose value is `undefined`, such as the correlation id of a message from outside the bus
 */
const definedAttributes = (
  attributes: Record<string, string | undefined>
): Attributes =>
  Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined)
  )

/**
 * The `error.type` of an error: the class name of what was thrown. When one handler failed, it's that handler's
 * error rather than the `HandlerDispatchRejected` the bus wraps it in.
 */
const errorType = (error: unknown): string => {
  const cause =
    error instanceof HandlerDispatchRejected && error.rejections.length === 1
      ? error.rejections[0]
      : error
  return cause instanceof Error
    ? cause.constructor.name
    : ERROR_TYPE_VALUE_OTHER
}

/**
 * Records an error on a span, and marks the span as failed
 */
const recordError = (span: Span, error: unknown): void => {
  span.recordException(error instanceof Error ? error : String(error))
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error)
  })
  span.setAttribute(ATTR_ERROR_TYPE, errorType(error))
}

const createInstruments = (options: OpenTelemetryOptions): Instruments => {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider()
  const meterProvider = options.meterProvider ?? metrics.getMeterProvider()
  const tracer = tracerProvider.getTracer(INSTRUMENTATION_SCOPE, undefined, {
    schemaUrl: SCHEMA_URL
  })
  const meter = meterProvider.getMeter(INSTRUMENTATION_SCOPE, undefined, {
    schemaUrl: SCHEMA_URL
  })
  return {
    tracer,
    sentMessages: meter.createCounter(METRIC_MESSAGING_CLIENT_SENT_MESSAGES, {
      description: 'Number of messages sent or published',
      unit: '{message}'
    }),
    consumedMessages: meter.createCounter(
      METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES,
      {
        description: 'Number of messages received and passed to the handlers',
        unit: '{message}'
      }
    ),
    failedMessages: meter.createCounter(METRIC_FAILED_MESSAGES, {
      description:
        'Number of messages whose handling failed, so they were returned to the queue',
      unit: '{message}'
    }),
    processDuration: meter.createHistogram(METRIC_MESSAGING_PROCESS_DURATION, {
      description: 'Duration of handling a received message',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS }
    }),
    criticalTime: meter.createHistogram(METRIC_CRITICAL_TIME, {
      description:
        'Time from when a message was sent until it was handled successfully',
      unit: 's',
      advice: { explicitBucketBoundaries: CRITICAL_TIME_BUCKETS }
    })
  }
}

/**
 * Creates middleware that traces and measures a bus with OpenTelemetry. Pass it to `withMiddleware()`, calling
 * `openTelemetry()` once for each bus.
 *
 * - **Spans**: a PRODUCER span `send <$name>` or `publish <$name>` for each message sent, a CONSUMER span
 *   `process <$name>` for each message received, and an INTERNAL span for each handler or workflow that handles
 *   it, named after it. Errors are recorded on the span they fail. A send span ends when its message reaches the
 *   transport, which for a send from a handler is after the handler resolves.
 * - **Trace context** is written into the `attributes` of each message sent, with the configured propagator (W3C
 *   `traceparent` and `tracestate` by default), and a process span is a child of the context its message carries.
 *   Attributes are carried by every transport, so the trace continues in the service that handles the message.
 * - **Metrics**: `messaging.process.duration`, `messaging.client.sent.messages`,
 *   `messaging.client.consumed.messages`, `node_ts_bus.failed.messages` and `node_ts_bus.critical_time`.
 *
 * Span parentage within a service relies on the OpenTelemetry context manager, which the Node SDK registers.
 * @param options the providers, propagator and attributes to use. Each defaults to the global one.
 * @returns middleware for the `incoming`, `handler` and `outgoing` stages
 * @example
 * import { openTelemetry } from '@node-ts/bus-opentelemetry'
 *
 * const bus = Bus.configure()
 *   .withTransport(transport)
 *   .withMiddleware(openTelemetry({ messagingSystem: 'rabbitmq', endpointName: transport.endpointName }))
 *   .build()
 */
export const openTelemetry = (
  options: OpenTelemetryOptions = {}
): BusMiddleware => {
  const messagingSystem = options.messagingSystem ?? DEFAULT_MESSAGING_SYSTEM
  const propagator = options.propagator ?? propagation

  // Created when the first message is sent or received rather than now, because the global meter provider is a
  // no-op until the SDK registers one, and its instruments would stay no-ops
  let instruments: Instruments | undefined
  const getInstruments = (): Instruments =>
    (instruments ??= createInstruments(options))

  /**
   * Runs `next` with `span` as the active span, in the context it was started in
   */
  const runInSpan = async (
    span: Span,
    parent: Context,
    next: () => Promise<void>
  ): Promise<void> => context.with(trace.setSpan(parent, span), next)

  return {
    outgoing: async (outgoingContext, next) => {
      const { tracer, sentMessages } = getInstruments()
      const { kind, message, attributes } = outgoingContext
      const metricAttributes: Attributes = {
        [ATTR_MESSAGING_SYSTEM]: messagingSystem,
        [ATTR_MESSAGING_OPERATION_NAME]: kind,
        [ATTR_MESSAGING_OPERATION_TYPE]: OPERATION_TYPE_SEND,
        [ATTR_MESSAGING_DESTINATION_NAME]: message.$name,
        [ATTR_MESSAGE_NAME]: message.$name
      }
      const parent = context.active()
      const span = tracer.startSpan(
        `${kind} ${message.$name}`,
        {
          kind: SpanKind.PRODUCER,
          attributes: {
            ...metricAttributes,
            ...definedAttributes({
              [ATTR_MESSAGING_MESSAGE_ID]: attributes.messageId,
              [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: attributes.correlationId
            })
          }
        },
        parent
      )

      // Replaces the attributes rather than changing them, since they can be the object the caller passed in. Any
      // trace context already in them, such as from forwarding a received message's attributes, is replaced.
      const traceContext: Record<string, string> = {}
      propagator.inject(
        trace.setSpan(parent, span),
        traceContext,
        defaultTextMapSetter
      )
      const fields = new Set(propagator.fields())
      outgoingContext.attributes = {
        ...attributes,
        attributes: {
          ...Object.fromEntries(
            Object.entries(attributes.attributes ?? {}).filter(
              ([key]) => !fields.has(key)
            )
          ),
          ...traceContext
        }
      }

      // Inside a handler the message is only sent once the handler resolves, so the span ends, and the message is
      // counted, when it reaches the transport rather than when next() resolves. The bus sends it with this span
      // active, so spans of the transport's own client are its children. A dropped message isn't counted.
      void outgoingContext.dispatched.then(
        () => {
          sentMessages.add(1, metricAttributes)
          span.end()
        },
        (error: unknown) => {
          if (error instanceof OutgoingMessageDropped) {
            span.setAttribute(ATTR_DROPPED_REASON, error.reason)
          } else {
            recordError(span, error)
            sentMessages.add(1, {
              ...metricAttributes,
              [ATTR_ERROR_TYPE]: errorType(error)
            })
          }
          span.end()
        }
      )
      await runInSpan(span, parent, next)
    },

    incoming: async (incomingContext, next) => {
      const {
        tracer,
        consumedMessages,
        failedMessages,
        processDuration,
        criticalTime
      } = getInstruments()
      const { message, attributes } = incomingContext
      const metricAttributes: Attributes = {
        [ATTR_MESSAGING_SYSTEM]: messagingSystem,
        [ATTR_MESSAGING_OPERATION_NAME]: OPERATION_PROCESS,
        [ATTR_MESSAGING_OPERATION_TYPE]: OPERATION_PROCESS,
        [ATTR_MESSAGE_NAME]: message.$name,
        ...definedAttributes({
          [ATTR_MESSAGING_DESTINATION_NAME]: options.endpointName || undefined
        })
      }
      // A message without trace context, such as one from outside the bus, starts a new trace
      const parent = propagator.extract(
        context.active(),
        attributes.attributes ?? {},
        attributesGetter
      )
      const span = tracer.startSpan(
        `${OPERATION_PROCESS} ${message.$name}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            ...metricAttributes,
            ...definedAttributes({
              [ATTR_MESSAGING_MESSAGE_ID]: attributes.messageId,
              [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: attributes.correlationId
            })
          }
        },
        parent
      )
      consumedMessages.add(1, metricAttributes)

      const started = performance.now()
      let outcomeAttributes: Attributes = {}
      try {
        await runInSpan(span, parent, next)
        const sentAt = Date.parse(attributes.sentAt ?? '')
        if (!Number.isNaN(sentAt)) {
          // Clocks on different hosts can disagree, which mustn't record a negative time
          criticalTime.record(
            Math.max(0, Date.now() - sentAt) / MILLISECONDS_IN_SECOND,
            metricAttributes
          )
        }
      } catch (error) {
        recordError(span, error)
        outcomeAttributes = { [ATTR_ERROR_TYPE]: errorType(error) }
        failedMessages.add(1, { ...metricAttributes, ...outcomeAttributes })
        throw error
      } finally {
        processDuration.record(
          (performance.now() - started) / MILLISECONDS_IN_SECOND,
          { ...metricAttributes, ...outcomeAttributes }
        )
        span.end()
      }
    },

    handler: async (handlerContext, next) => {
      const { tracer } = getInstruments()
      const { message, attributes, handlerName } = handlerContext
      const parent = context.active()
      const span = tracer.startSpan(
        handlerName,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            [ATTR_MESSAGING_SYSTEM]: messagingSystem,
            [ATTR_MESSAGE_NAME]: message.$name,
            [ATTR_HANDLER_NAME]: handlerName,
            ...definedAttributes({
              [ATTR_MESSAGING_MESSAGE_ID]: attributes.messageId,
              [ATTR_MESSAGING_MESSAGE_CONVERSATION_ID]: attributes.correlationId
            })
          }
        },
        parent
      )

      try {
        await runInSpan(span, parent, next)
      } catch (error) {
        recordError(span, error)
        throw error
      } finally {
        span.end()
      }
    }
  }
}
