import { Bus, BusInstance, handlerFor, Logger } from '@node-ts/bus-core'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import { openTelemetry } from './open-telemetry'
import {
  buildTracedBus,
  handledEvent,
  messageTypes,
  TestTelemetry,
  TracedCommand,
  TracedEvent,
  useContextManager
} from './test'

jest.setTimeout(10_000)

const ENDPOINT_NAME = 'reservations-service'

describe('openTelemetry', () => {
  let disableContextManager: () => void
  beforeAll(() => {
    disableContextManager = useContextManager()
  })
  afterAll(() => disableContextManager())

  describe('when a command is sent and its handler publishes an event', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let sendSpan: ReadableSpan
    let processCommandSpan: ReadableSpan
    let commandHandlerSpan: ReadableSpan
    let publishSpan: ReadableSpan
    let processEventSpan: ReadableSpan
    let eventHandlerSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = buildTracedBus({
        telemetry,
        handled,
        openTelemetryOptions: { endpointName: ENDPOINT_NAME }
      })
      await bus.initialize()
      await bus.start()

      const eventHandled = once(
        handled,
        handledEvent(TracedEvent.NAME, 'in-memory')
      )
      await bus.send(new TracedCommand('in-memory'), {
        messageId: 'message-1',
        correlationId: 'conversation-1'
      })
      await eventHandled

      sendSpan = telemetry.span(`send ${TracedCommand.NAME}`)
      processCommandSpan = telemetry.span(`process ${TracedCommand.NAME}`)
      commandHandlerSpan = telemetry.span('reserveRoom')
      publishSpan = telemetry.span(`publish ${TracedEvent.NAME}`)
      processEventSpan = telemetry.span(`process ${TracedEvent.NAME}`)
      eventHandlerSpan = telemetry.span('sendConfirmation')
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should start the trace with the send span', () => {
      expect(sendSpan.kind).toEqual(SpanKind.PRODUCER)
      expect(sendSpan.parentSpanContext).toBeUndefined()
    })

    it('should process the command in a child of the send span', () => {
      expect(processCommandSpan.kind).toEqual(SpanKind.CONSUMER)
      expect(processCommandSpan.parentSpanContext?.spanId).toEqual(
        sendSpan.spanContext().spanId
      )
    })

    it('should call the handler in a child of the process span', () => {
      expect(commandHandlerSpan.kind).toEqual(SpanKind.INTERNAL)
      expect(commandHandlerSpan.parentSpanContext?.spanId).toEqual(
        processCommandSpan.spanContext().spanId
      )
    })

    it('should publish the event in a child of the handler span', () => {
      expect(publishSpan.kind).toEqual(SpanKind.PRODUCER)
      expect(publishSpan.parentSpanContext?.spanId).toEqual(
        commandHandlerSpan.spanContext().spanId
      )
    })

    it('should process the event in a child of the publish span', () => {
      expect(processEventSpan.parentSpanContext?.spanId).toEqual(
        publishSpan.spanContext().spanId
      )
      expect(eventHandlerSpan.parentSpanContext?.spanId).toEqual(
        processEventSpan.spanContext().spanId
      )
    })

    it('should keep every span in one trace', () => {
      const traceIds = new Set(
        telemetry.spans().map(span => span.spanContext().traceId)
      )
      expect(traceIds.size).toEqual(1)
    })

    it('should put the semantic convention attributes on the send span', () => {
      expect(sendSpan.attributes).toEqual({
        'messaging.system': 'node_ts_bus',
        'messaging.operation.name': 'send',
        'messaging.operation.type': 'send',
        'messaging.destination.name': TracedCommand.NAME,
        'messaging.message.id': 'message-1',
        'messaging.message.conversation_id': 'conversation-1',
        'node_ts_bus.message.name': TracedCommand.NAME
      })
    })

    it('should put the semantic convention attributes on the process span', () => {
      expect(processCommandSpan.attributes).toEqual({
        'messaging.system': 'node_ts_bus',
        'messaging.operation.name': 'process',
        'messaging.operation.type': 'process',
        'messaging.destination.name': ENDPOINT_NAME,
        'messaging.message.id': 'message-1',
        'messaging.message.conversation_id': 'conversation-1',
        'node_ts_bus.message.name': TracedCommand.NAME,
        'node_ts_bus.message.failed_attempts': 0
      })
    })

    it('should name the handler span after the handler', () => {
      expect(commandHandlerSpan.attributes).toMatchObject({
        'node_ts_bus.handler.name': 'reserveRoom',
        'node_ts_bus.message.name': TracedCommand.NAME,
        'messaging.message.id': 'message-1'
      })
    })

    it('should carry the correlation id to the published event', () => {
      expect(publishSpan.attributes['messaging.operation.name']).toEqual(
        'publish'
      )
      expect(publishSpan.attributes['messaging.operation.type']).toEqual('send')
      expect(
        publishSpan.attributes['messaging.message.conversation_id']
      ).toEqual('conversation-1')
    })

    it('should count each message sent', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      expect(
        points.map(point => [
          point.attributes['messaging.operation.name'],
          point.attributes['messaging.destination.name'],
          point.value
        ])
      ).toEqual(
        expect.arrayContaining([
          ['send', TracedCommand.NAME, 1],
          ['publish', TracedEvent.NAME, 1]
        ])
      )
      expect(points).toHaveLength(2)
    })

    it('should count each message consumed', async () => {
      const points = await telemetry.metric(
        'messaging.client.consumed.messages'
      )
      expect(
        points.map(point => [
          point.attributes['node_ts_bus.message.name'],
          point.attributes['messaging.destination.name'],
          point.value
        ])
      ).toEqual(
        expect.arrayContaining([
          [TracedCommand.NAME, ENDPOINT_NAME, 1],
          [TracedEvent.NAME, ENDPOINT_NAME, 1]
        ])
      )
    })

    it('should record how long each message took to process', async () => {
      const points = await telemetry.metric('messaging.process.duration')
      expect(points.map(point => point.value)).toEqual([1, 1])
      expect(points.every(point => !('error.type' in point.attributes))).toBe(
        true
      )
    })

    it('should record the critical time of each message', async () => {
      const points = await telemetry.metric('node_ts_bus.critical_time')
      expect(points.map(point => point.value)).toEqual([1, 1])
    })

    it('should not count any failures', async () => {
      expect(await telemetry.metric('node_ts_bus.failed.messages')).toEqual([])
    })
  })

  describe('when a handler publishes an event and then fails, and succeeds on retry', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let failedProcessSpan: ReadableSpan
    let failedHandlerSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = buildTracedBus({ telemetry, handled, failFirstAttempt: true })
      await bus.initialize()
      await bus.start()

      const eventHandled = once(
        handled,
        handledEvent(TracedEvent.NAME, 'retry')
      )
      await bus.send(new TracedCommand('retry'))
      await eventHandled

      failedProcessSpan = telemetry
        .spans()
        .find(
          span =>
            span.name === `process ${TracedCommand.NAME}` &&
            span.status.code === SpanStatusCode.ERROR
        )!
      failedHandlerSpan = telemetry.childOf(failedProcessSpan, 'reserveRoom')
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should process the command twice in the same trace', () => {
      const sendSpan = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(
        telemetry.childrenOf(sendSpan, `process ${TracedCommand.NAME}`)
      ).toHaveLength(2)
    })

    it('should record how many attempts failed before each one', () => {
      const sendSpan = telemetry.span(`send ${TracedCommand.NAME}`)
      const attempts = telemetry
        .childrenOf(sendSpan, `process ${TracedCommand.NAME}`)
        .map(span => span.attributes['node_ts_bus.message.failed_attempts'])
      expect(attempts.sort()).toEqual([0, 1])
    })

    it('should record the error on the failed process span', () => {
      expect(failedProcessSpan.status.code).toEqual(SpanStatusCode.ERROR)
      expect(failedProcessSpan.attributes['error.type']).toEqual(
        'RoomUnavailable'
      )
      expect(failedProcessSpan.events.map(event => event.name)).toEqual([
        'exception'
      ])
    })

    it('should record the error on the failed handler span', () => {
      expect(failedHandlerSpan.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'No rooms left'
      })
      expect(failedHandlerSpan.attributes['error.type']).toEqual(
        'RoomUnavailable'
      )
    })

    it('should count the failure with its error type', async () => {
      const [point] = await telemetry.metric('node_ts_bus.failed.messages')
      expect(point.value).toEqual(1)
      expect(point.attributes).toMatchObject({
        'error.type': 'RoomUnavailable',
        'node_ts_bus.message.name': TracedCommand.NAME
      })
    })

    it('should record the failed and successful process durations apart', async () => {
      const points = await telemetry.metric('messaging.process.duration')
      const commandPoints = points.filter(
        point =>
          point.attributes['node_ts_bus.message.name'] === TracedCommand.NAME
      )
      expect(
        commandPoints.map(point => [
          point.attributes['error.type'],
          point.value
        ])
      ).toEqual(
        expect.arrayContaining([
          ['RoomUnavailable', 1],
          [undefined, 1]
        ])
      )
    })

    it('should only count the event published by the attempt that succeeded', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      const published = points.find(
        point => point.attributes['messaging.operation.name'] === 'publish'
      )
      expect(published?.value).toEqual(1)
    })
  })

  describe('when a message is received without a trace context', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TracedEvent, async () => undefined))
        .withMiddleware(
          {
            incoming: async (context, next) => {
              await next()
              handled.emit(context.message.$name)
            }
          },
          openTelemetry(telemetry.options()),
          {
            // Strips the trace context, as a message from outside the bus wouldn't have one
            outgoing: async (context, next) => {
              context.attributes = { ...context.attributes, attributes: {} }
              await next()
            }
          }
        )
        .build()
      await bus.initialize()
      await bus.start()

      const eventHandled = once(handled, TracedEvent.NAME)
      await bus.publish(new TracedEvent('no-trace-context'))
      await eventHandled
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should start a new trace for it', () => {
      const publishSpan = telemetry.span(`publish ${TracedEvent.NAME}`)
      const processSpan = telemetry.span(`process ${TracedEvent.NAME}`)
      expect(processSpan.parentSpanContext).toBeUndefined()
      expect(processSpan.spanContext().traceId).not.toEqual(
        publishSpan.spanContext().traceId
      )
    })
  })
})
