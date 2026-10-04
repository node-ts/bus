import {
  Bus,
  BusInstance,
  BusMiddleware,
  HandlerContext,
  handlerFor,
  Logger,
  retry,
  Transport
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import { openTelemetry } from '../open-telemetry'
import { OpenTelemetryOptions } from '../open-telemetry-options'
import { messageTypes } from './message-types.generated'
import { TestTelemetry } from './test-telemetry'
import { TracedCommand } from './traced-command'
import { TracedEvent } from './traced-event'

/**
 * Thrown by the `TracedCommand` handler of a bus built to fail its first attempt
 */
export class RoomUnavailable extends Error {}

/**
 * The name `handled` emits once a message of a run has been handled and all of its spans have ended
 */
export const handledEvent = (messageName: string, runId: string): string =>
  `${messageName}:${runId}`

export interface TracedBusOptions {
  telemetry: TestTelemetry
  /**
   * Emits `handledEvent(message.$name, runId)` once each message has been handled, with the attributes it was
   * received with
   */
  handled: EventEmitter
  transport?: Transport
  openTelemetryOptions?: OpenTelemetryOptions
  /**
   * Makes the `TracedCommand` handler publish and then throw the first time it's called
   */
  failFirstAttempt?: boolean
}

/**
 * Builds a bus that handles `TracedCommand` with `reserveRoom`, which publishes a `TracedEvent`, and handles that
 * with `sendConfirmation`, instrumented with `openTelemetry()`. An incoming middleware registered before it reports
 * each handled message on `handled`, by which time all of its spans have ended.
 */
export const buildTracedBus = ({
  telemetry,
  handled,
  transport,
  openTelemetryOptions,
  failFirstAttempt = false
}: TracedBusOptions): BusInstance => {
  let attempts = 0
  const reserveRoom = async (
    command: TracedCommand,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) => {
    await ctx.publish(new TracedEvent(command.runId))
    attempts++
    if (failFirstAttempt && attempts === 1) {
      throw new RoomUnavailable('No rooms left')
    }
  }
  const sendConfirmation = async () => undefined

  const reportHandled: BusMiddleware = {
    incoming: async (context, next) => {
      try {
        await next()
      } finally {
        const { runId } = context.message as TracedCommand | TracedEvent
        handled.emit(
          handledEvent(context.message.$name, runId),
          context.attributes.attributes
        )
      }
    }
  }

  const configuration = Bus.configure()
    .withMessageTypes(messageTypes)
    .withLogger(() => Mock.ofType<Logger>().object)
    .withRecoverability(() => retry(0))
    .withHandler(handlerFor(TracedCommand, reserveRoom))
    .withHandler(handlerFor(TracedEvent, sendConfirmation))
    .withMiddleware(
      reportHandled,
      openTelemetry(telemetry.options(openTelemetryOptions))
    )
  if (transport) {
    configuration.withTransport(transport)
  }
  return configuration.build()
}
