import {
  Bus,
  BusInstance,
  BusMiddleware,
  HandlerContext,
  handlerFor,
  Logger,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { SpanStatusCode } from '@opentelemetry/api'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import { openTelemetry } from './open-telemetry'
import {
  buildTracedBus,
  handledEvent,
  InstrumentedInMemoryQueue,
  messageTypes,
  reservationFunctionWorkflow,
  ReservationWorkflow,
  ReservationWorkflowState,
  TestTelemetry,
  TracedCommand,
  TracedEvent,
  useContextManager
} from './test'

jest.setTimeout(10_000)

const silentLogger = () => Mock.ofType<Logger>().object

class MessageRejected extends Error {}

/**
 * Lets the middleware's handlers of `dispatched` run
 */
const settle = async (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve))

/**
 * Emits each handled message's `$name` on `handled` once all of its spans have ended. Register it before
 * `openTelemetry()`, so it's outermost.
 */
const reportHandled = (handled: EventEmitter): BusMiddleware => ({
  incoming: async (context, next) => {
    try {
      await next()
    } finally {
      handled.emit(context.message.$name)
    }
  }
})

describe('openTelemetry', () => {
  let disableContextManager: () => void
  beforeAll(() => {
    disableContextManager = useContextManager()
  })
  afterAll(() => disableContextManager())

  describe.each([
    {
      style: 'class',
      workflow: ReservationWorkflow,
      spanName: 'ReservationWorkflow'
    },
    {
      style: 'function',
      workflow: reservationFunctionWorkflow,
      spanName: ReservationWorkflowState.NAME
    }
  ])('when a $style workflow handles a message', ({ workflow, spanName }) => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let processSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withWorkflow(workflow)
        .withMiddleware(
          reportHandled(handled),
          openTelemetry(telemetry.options())
        )
        .build()
      await bus.initialize()
      await bus.start()
      const commandHandled = once(handled, TracedCommand.NAME)
      await bus.send(new TracedCommand('workflow'))
      await commandHandled
      processSpan = telemetry.span(`process ${TracedCommand.NAME}`)
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should name the handler span after the workflow', () => {
      const span = telemetry.childOf(processSpan, spanName)
      expect(span.attributes['node_ts_bus.handler.name']).toEqual(spanName)
      expect(span.status.code).toEqual(SpanStatusCode.UNSET)
    })
  })

  describe('when two handlers handle the same message', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let processSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      const publishEvent = async (
        command: TracedCommand,
        _attributes: MessageAttributes,
        ctx: HandlerContext
      ) => ctx.publish(new TracedEvent(command.runId))
      const reserveRoom = publishEvent
      const chargeCard: typeof publishEvent = async (...args) =>
        publishEvent(...args)
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withHandler(handlerFor(TracedCommand, reserveRoom))
        .withHandler(handlerFor(TracedCommand, chargeCard))
        .withMiddleware(
          reportHandled(handled),
          openTelemetry(telemetry.options())
        )
        .build()
      await bus.initialize()
      await bus.start()
      const commandHandled = once(handled, TracedCommand.NAME)
      await bus.send(new TracedCommand('two-handlers'))
      await commandHandled
      await settle()
      processSpan = telemetry.span(`process ${TracedCommand.NAME}`)
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should give each handler its own span under the process span', () => {
      expect(telemetry.childOf(processSpan, 'publishEvent')).toBeDefined()
      expect(telemetry.childOf(processSpan, 'chargeCard')).toBeDefined()
    })

    it("should publish each handler's event under that handler's span", () => {
      for (const handlerName of ['publishEvent', 'chargeCard']) {
        const handlerSpan = telemetry.childOf(processSpan, handlerName)
        expect(
          telemetry.childOf(handlerSpan, `publish ${TracedEvent.NAME}`)
        ).toBeDefined()
      }
    })

    it('should count both events as sent', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      const published = points.find(
        point => point.attributes['messaging.operation.name'] === 'publish'
      )
      expect(published?.value).toEqual(2)
    })
  })

  describe('when the bus handles several messages at once', () => {
    const telemetry = new TestTelemetry()
    const runIds = Array.from({ length: 8 }, () => randomUUID())
    let bus: BusInstance

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withConcurrency(4)
        .withHandler(
          handlerFor(
            TracedCommand,
            async function reserveRoom(command, _a, ctx) {
              // Interleaves the handlers, so their async contexts overlap
              await new Promise(resolve => setTimeout(resolve, 20))
              await ctx.publish(new TracedEvent(command.runId))
            }
          )
        )
        .withHandler(
          handlerFor(TracedEvent, async function sendConfirmation() {
            await new Promise(resolve => setTimeout(resolve, 5))
          })
        )
        .withMiddleware(
          {
            incoming: async (context, next) => {
              try {
                await next()
              } finally {
                const { runId } = context.message as TracedCommand | TracedEvent
                handled.emit(handledEvent(context.message.$name, runId))
              }
            }
          },
          openTelemetry(telemetry.options())
        )
        .build()
      await bus.initialize()
      await bus.start()
      const eventsHandled = Promise.all(
        runIds.map(async runId =>
          once(handled, handledEvent(TracedEvent.NAME, runId))
        )
      )
      await Promise.all(
        runIds.map(async runId =>
          bus.send(new TracedCommand(runId), { messageId: runId })
        )
      )
      await eventsHandled
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should keep each message in its own trace', () => {
      for (const runId of runIds) {
        const sendSpan = telemetry.spanWith(
          `send ${TracedCommand.NAME}`,
          'messaging.message.id',
          runId
        )
        const processSpan = telemetry.childOf(
          sendSpan,
          `process ${TracedCommand.NAME}`
        )
        const handlerSpan = telemetry.childOf(processSpan, 'reserveRoom')
        const publishSpan = telemetry.childOf(
          handlerSpan,
          `publish ${TracedEvent.NAME}`
        )
        const processEventSpan = telemetry.childOf(
          publishSpan,
          `process ${TracedEvent.NAME}`
        )
        expect(processEventSpan.spanContext().traceId).toEqual(
          sendSpan.spanContext().traceId
        )
      }
    })

    it('should start a separate trace for each message', () => {
      const traceIds = new Set(
        telemetry
          .spans()
          .filter(span => span.name === `send ${TracedCommand.NAME}`)
          .map(span => span.spanContext().traceId)
      )
      expect(traceIds.size).toEqual(runIds.length)
    })
  })

  describe('when incoming middleware publishes a message', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let processSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withHandler(handlerFor(TracedCommand, async () => undefined))
        .withMiddleware(
          reportHandled(handled),
          openTelemetry(telemetry.options()),
          {
            incoming: async (context, next) => {
              if (context.message.$name === TracedCommand.NAME) {
                await context.publish(new TracedEvent('incoming'))
              }
              await next()
            }
          }
        )
        .build()
      await bus.initialize()
      await bus.start()
      const commandHandled = once(handled, TracedCommand.NAME)
      await bus.send(new TracedCommand('incoming'))
      await commandHandled
      await settle()
      processSpan = telemetry.span(`process ${TracedCommand.NAME}`)
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should publish it under the process span', () => {
      expect(
        telemetry.childOf(processSpan, `publish ${TracedEvent.NAME}`)
      ).toBeDefined()
    })

    it('should count it as sent', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      const published = points.find(
        point => point.attributes['messaging.operation.name'] === 'publish'
      )
      expect(published?.value).toEqual(1)
    })
  })

  describe('when a middleware registered after openTelemetry() rejects a send', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let sendError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withMiddleware(openTelemetry(telemetry.options()), {
          outgoing: async () => {
            throw new MessageRejected('Validation failed')
          }
        })
        .build()
      await bus.initialize()
      sendError = await bus
        .send(new TracedCommand('rejected'))
        .catch((error: unknown) => error)
      await settle()
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should reject the send', () => {
      expect(sendError).toBeInstanceOf(MessageRejected)
    })

    it('should not count it as sent', async () => {
      expect(await telemetry.metric('messaging.client.sent.messages')).toEqual(
        []
      )
    })

    it('should mark the send span as rejected, with the middleware error', () => {
      const span = telemetry.span(`send ${TracedCommand.NAME}`)
      expect(span.attributes['node_ts_bus.dropped.reason']).toEqual('rejected')
      expect(span.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'Validation failed'
      })
      expect(span.attributes['error.type']).toEqual('MessageRejected')
    })
  })

  describe('when a handler publishes an event and then fails the message', () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withHandler(
          handlerFor(
            TracedCommand,
            async function reserveRoom(command, _a, ctx) {
              await ctx.publish(new TracedEvent(command.runId))
              await ctx.failMessage()
            }
          )
        )
        .withMiddleware(
          reportHandled(handled),
          openTelemetry(telemetry.options())
        )
        .build()
      await bus.initialize()
      await bus.start()
      const commandHandled = once(handled, TracedCommand.NAME)
      await bus.send(new TracedCommand('fail-message'))
      await commandHandled
      await settle()
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should record the process span as failed, without a critical time', async () => {
      const span = telemetry.span(`process ${TracedCommand.NAME}`)
      expect(span.status.code).toEqual(SpanStatusCode.ERROR)
      expect(span.attributes['error.type']).toEqual('FailMessageRequested')
      expect(await telemetry.metric('node_ts_bus.critical_time')).toEqual([])
      const [failed] = await telemetry.metric('node_ts_bus.failed.messages')
      expect(failed.value).toEqual(1)
    })

    it('should mark the publish span as dropped', () => {
      const span = telemetry.span(`publish ${TracedEvent.NAME}`)
      expect(span.attributes['node_ts_bus.dropped.reason']).toEqual(
        'message-failed-or-returned'
      )
    })

    it('should not count the event as sent', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      expect(
        points.filter(
          point => point.attributes['messaging.operation.name'] === 'publish'
        )
      ).toEqual([])
    })
  })

  describe("when the transport fails to send a message from a handler's outbox", () => {
    const telemetry = new TestTelemetry()
    let bus: BusInstance
    let failedPublishSpan: ReadableSpan
    let sentPublishSpan: ReadableSpan

    beforeAll(async () => {
      const handled = new EventEmitter()
      const transport = new InstrumentedInMemoryQueue(
        telemetry.tracerProvider.getTracer('broker-client'),
        true
      )
      bus = buildTracedBus({ telemetry, handled, transport })
      await bus.initialize()
      await bus.start()
      const eventHandled = once(
        handled,
        handledEvent(TracedEvent.NAME, 'flush-fails')
      )
      await bus.send(new TracedCommand('flush-fails'))
      await eventHandled

      const publishSpans = telemetry
        .spans()
        .filter(span => span.name === `publish ${TracedEvent.NAME}`)
      failedPublishSpan = publishSpans.find(
        span => span.status.code === SpanStatusCode.ERROR
      )!
      sentPublishSpan = publishSpans.find(
        span => span.status.code === SpanStatusCode.UNSET
      )!
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it("should record the transport's error on the publish span", () => {
      expect(failedPublishSpan.attributes['error.type']).toEqual(
        'BrokerUnavailable'
      )
      expect(failedPublishSpan.status.message).toEqual('Broker unavailable')
    })

    it('should make the broker client spans children of the publish spans', () => {
      expect(
        telemetry.childOf(failedPublishSpan, 'client publish')
      ).toBeDefined()
      expect(telemetry.childOf(sentPublishSpan, 'client publish')).toBeDefined()
    })

    it('should count the failed and the successful publish apart', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      const publishes = points.filter(
        point => point.attributes['messaging.operation.name'] === 'publish'
      )
      expect(
        publishes.map(point => [point.attributes['error.type'], point.value])
      ).toEqual(
        expect.arrayContaining([
          ['BrokerUnavailable', 1],
          [undefined, 1]
        ])
      )
    })

    it('should count the failed attempt at handling the command', async () => {
      const [point] = await telemetry.metric('node_ts_bus.failed.messages')
      expect(point.value).toEqual(1)
      expect(point.attributes['error.type']).toEqual('BrokerUnavailable')
    })
  })

  describe('when a Receiver passes in a message that carries a trace context', () => {
    const telemetry = new TestTelemetry()
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const sendSpanId = '00f067aa0ba902b7'
    let bus: BusInstance
    let processSpan: ReadableSpan

    beforeAll(async () => {
      const receiver: Receiver<TracedCommand> = {
        receive: async (
          command: TracedCommand
        ): Promise<TransportMessage<unknown>> => ({
          id: 'lambda-record',
          domainMessage: command,
          raw: command,
          failedAttempts: 2,
          attributes: {
            attributes: { traceparent: `00-${traceId}-${sendSpanId}-01` },
            stickyAttributes: {},
            messageId: 'received-1'
          }
        })
      }
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(silentLogger)
        .withReceiver(receiver)
        .withHandler(
          handlerFor(
            TracedCommand,
            async function reserveRoom(command, _a, ctx) {
              await ctx.publish(new TracedEvent(command.runId))
            }
          )
        )
        .withMiddleware(openTelemetry(telemetry.options()))
        .build()
      await bus.initialize()
      await bus.receive(new TracedCommand('receiver'))
      await settle()
      processSpan = telemetry.span(`process ${TracedCommand.NAME}`)
    })

    afterAll(async () => {
      await bus.dispose()
      await telemetry.shutdown()
    })

    it('should continue the trace the message carries', () => {
      expect(processSpan.spanContext().traceId).toEqual(traceId)
      expect(processSpan.parentSpanContext?.spanId).toEqual(sendSpanId)
      expect(processSpan.attributes['messaging.message.id']).toEqual(
        'received-1'
      )
      expect(
        processSpan.attributes['node_ts_bus.message.failed_attempts']
      ).toEqual(2)
    })

    it("should publish the handler's event under its handler span", () => {
      const handlerSpan = telemetry.childOf(processSpan, 'reserveRoom')
      expect(
        telemetry.childOf(handlerSpan, `publish ${TracedEvent.NAME}`)
      ).toBeDefined()
    })

    it('should count the event as sent', async () => {
      const points = await telemetry.metric('messaging.client.sent.messages')
      expect(points.map(point => point.value)).toEqual([1])
    })
  })
})
