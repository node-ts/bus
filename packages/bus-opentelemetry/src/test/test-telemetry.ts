import { Attributes, context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  DataPointType,
  MeterProvider,
  MetricReader
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base'
import { OpenTelemetryOptions } from '../open-telemetry-options'

/**
 * A metric reader that only collects when a test asks it to
 */
class TestMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

/**
 * A data point of a metric: the value of a counter, or the count and sum of a histogram
 */
export interface RecordedPoint {
  attributes: Attributes
  value: number
  sum?: number
}

/**
 * An in-memory span exporter and metric reader, with the options that point `openTelemetry()` at them. The providers
 * are passed in rather than registered globally, so each test sees only its own bus' telemetry.
 */
export class TestTelemetry {
  readonly spanExporter = new InMemorySpanExporter()
  readonly tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(this.spanExporter)]
  })
  private readonly metricReader = new TestMetricReader()
  readonly meterProvider = new MeterProvider({ readers: [this.metricReader] })

  /**
   * The options that send a bus' telemetry here
   * @param options any other options to pass
   */
  options(options: OpenTelemetryOptions = {}): OpenTelemetryOptions {
    return {
      tracerProvider: this.tracerProvider,
      meterProvider: this.meterProvider,
      propagator: new W3CTraceContextPropagator(),
      ...options
    }
  }

  /**
   * The spans that have ended
   */
  spans(): ReadableSpan[] {
    return this.spanExporter.getFinishedSpans()
  }

  /**
   * The span with a name, which must have ended exactly once
   */
  span(name: string): ReadableSpan {
    const matching = this.spans().filter(span => span.name === name)
    if (matching.length !== 1) {
      throw new Error(
        `Expected one span named "${name}" but found ${matching.length}: ${this.spans()
          .map(span => span.name)
          .join(', ')}`
      )
    }
    return matching[0]
  }

  /**
   * The spans with a name whose parent is `parent`
   */
  childrenOf(parent: ReadableSpan, name: string): ReadableSpan[] {
    return this.spans().filter(
      span =>
        span.name === name &&
        span.parentSpanContext?.spanId === parent.spanContext().spanId
    )
  }

  /**
   * The one span with a name whose parent is `parent`
   */
  childOf(parent: ReadableSpan, name: string): ReadableSpan {
    const children = this.childrenOf(parent, name)
    if (children.length !== 1) {
      throw new Error(
        `Expected one span named "${name}" under "${parent.name}" but found ${children.length}`
      )
    }
    return children[0]
  }

  /**
   * The span with a name that has an attribute, such as the send span of a message id
   */
  spanWith(name: string, attribute: string, value: string): ReadableSpan {
    const matching = this.spans().filter(
      span => span.name === name && span.attributes[attribute] === value
    )
    if (matching.length !== 1) {
      throw new Error(
        `Expected one span named "${name}" with ${attribute}=${value} but found ${matching.length}`
      )
    }
    return matching[0]
  }

  /**
   * The data points recorded so far for a metric, or none if it hasn't been recorded
   */
  async metric(name: string): Promise<RecordedPoint[]> {
    const { resourceMetrics } = await this.metricReader.collect()
    const metric = resourceMetrics.scopeMetrics
      .flatMap(scopeMetrics => scopeMetrics.metrics)
      .find(m => m.descriptor.name === name)
    if (!metric) {
      return []
    }
    if (metric.dataPointType === DataPointType.HISTOGRAM) {
      return metric.dataPoints.map(point => ({
        attributes: point.attributes,
        value: point.value.count,
        sum: point.value.sum
      }))
    }
    if (metric.dataPointType === DataPointType.SUM) {
      return metric.dataPoints.map(point => ({
        attributes: point.attributes,
        value: point.value
      }))
    }
    throw new Error(`Metric ${name} is a ${metric.dataPointType}`)
  }

  async shutdown(): Promise<void> {
    await this.tracerProvider.shutdown()
    await this.meterProvider.shutdown()
  }
}

/**
 * Registers the context manager the Node SDK registers, which carries the active span through async calls
 * @returns a function that unregisters it again
 */
export const useContextManager = (): (() => void) => {
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)
  return () => {
    contextManager.disable()
    context.disable()
  }
}
