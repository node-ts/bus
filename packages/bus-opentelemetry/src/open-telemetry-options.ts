import type {
  MeterProvider,
  TextMapPropagator,
  TracerProvider
} from '@opentelemetry/api'

/**
 * Options for `openTelemetry()`. Every option is optional: by default the middleware uses the tracer provider, meter
 * provider and propagator registered with the OpenTelemetry API, which the Node SDK sets up.
 * @example
 * const transport = new RabbitMqTransport(configuration)
 * Bus.configure()
 *   .withTransport(transport)
 *   .withMiddleware(
 *     openTelemetry({ messagingSystem: 'rabbitmq', endpointName: transport.endpointName })
 *   )
 */
export interface OpenTelemetryOptions {
  /**
   * The `messaging.system` attribute of every span and metric. Use the value the OpenTelemetry messaging conventions
   * give your broker, such as `rabbitmq` or `aws_sqs`.
   * @default 'node_ts_bus'
   */
  messagingSystem?: string

  /**
   * The name of the queue the bus receives from, usually the transport's `endpointName`. It's the
   * `messaging.destination.name` of process spans and their metrics, which leave it out when it isn't set.
   */
  endpointName?: string

  /**
   * The tracer provider to create spans with. Pass one to keep this bus' spans apart from the global provider's.
   * @default the global tracer provider, `trace.getTracerProvider()`
   */
  tracerProvider?: TracerProvider

  /**
   * The meter provider to record metrics with. Pass one to keep this bus' metrics apart from the global provider's.
   * @default the global meter provider, `metrics.getMeterProvider()`, read when the first message is sent or received
   */
  meterProvider?: MeterProvider

  /**
   * Writes the trace context into the attributes of each message sent, and reads it from each message received.
   * @default the global propagator, `propagation`, which the Node SDK sets to W3C trace context (`traceparent` and
   * `tracestate`)
   */
  propagator?: TextMapPropagator
}
