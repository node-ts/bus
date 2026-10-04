import { InMemoryQueue, TransportSendOptions } from '@node-ts/bus-core'
import { Event, MessageAttributes } from '@node-ts/bus-messages'
import { Tracer } from '@opentelemetry/api'

/**
 * Thrown by an `InstrumentedInMemoryQueue` the first time it publishes an event
 */
export class BrokerUnavailable extends Error {}

/**
 * An in-memory queue that starts a `client publish` span for each event it publishes, as an auto-instrumented broker
 * client would, so tests can check it's a child of the bus' publish span. It fails the first publish when
 * `failFirstPublish` is set.
 */
export class InstrumentedInMemoryQueue extends InMemoryQueue {
  private publishes = 0

  constructor(
    private readonly tracer: Tracer,
    private readonly failFirstPublish = false
  ) {
    super()
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    const span = this.tracer.startSpan('client publish')
    try {
      this.publishes++
      if (this.failFirstPublish && this.publishes === 1) {
        throw new BrokerUnavailable('Broker unavailable')
      }
      await super.publish(event, messageOptions, sendOptions)
    } finally {
      span.end()
    }
  }
}
