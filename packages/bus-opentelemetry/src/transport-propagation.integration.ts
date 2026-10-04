import { SNSClient } from '@aws-sdk/client-sns'
import { DeleteQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import { BusInstance, InMemoryQueue, Transport } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { SqsTransport } from '@node-ts/bus-sqs'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import {
  buildTracedBus,
  handledEvent,
  TestTelemetry,
  TracedCommand,
  TracedEvent,
  TracedReply,
  useContextManager
} from './test'

jest.setTimeout(30_000)

// Overridable so CI and contributors can point at LocalStack and RabbitMQ on a different host/port
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@0.0.0.0'
const AWS_REGION = process.env.AWS_REGION!
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!

const sqs = new SQSClient({ endpoint: LOCALSTACK_ENDPOINT, region: AWS_REGION })
const sns = new SNSClient({ endpoint: LOCALSTACK_ENDPOINT, region: AWS_REGION })

interface TransportUnderTest {
  name: string
  messagingSystem: string
  createTransport: () => Transport
  cleanUp?: (transport: Transport) => Promise<void>
}

const transports: TransportUnderTest[] = [
  {
    name: 'the in-memory queue',
    messagingSystem: 'node_ts_bus',
    createTransport: () => new InMemoryQueue()
  },
  {
    name: 'RabbitMQ',
    messagingSystem: 'rabbitmq',
    createTransport: () =>
      new RabbitMqTransport({
        queueName: 'node-ts-bus-opentelemetry-test',
        deadLetterQueueName: 'node-ts-bus-opentelemetry-test-dead-letter',
        connectionString: RABBITMQ_URL
      })
  },
  {
    name: 'Amazon SQS',
    messagingSystem: 'aws_sqs',
    createTransport: () =>
      new SqsTransport(
        {
          awsRegion: AWS_REGION,
          awsAccountId: AWS_ACCOUNT_ID,
          queueName: 'integration-bus-opentelemetry-test',
          deadLetterQueueName: 'integration-bus-opentelemetry-test-dead-letter',
          waitTimeSeconds: 1
        },
        sqs,
        sns
      ),
    cleanUp: async transport => {
      const sqsTransport = transport as SqsTransport
      await sqs.send(
        new DeleteQueueCommand({ QueueUrl: sqsTransport.queueUrl })
      )
      await sqs.send(
        new DeleteQueueCommand({ QueueUrl: sqsTransport.deadLetterQueueUrl })
      )
    }
  }
]

describe('openTelemetry', () => {
  let disableContextManager: () => void
  beforeAll(() => {
    disableContextManager = useContextManager()
  })
  afterAll(() => disableContextManager())

  describe.each(transports)(
    'when a message is sent over $name',
    ({ messagingSystem, createTransport, cleanUp }) => {
      const telemetry = new TestTelemetry()
      // Messages left on a shared queue by an earlier run are handled too, so this run's spans are found by its ids
      const runId = randomUUID()
      const messageId = randomUUID()
      const transport = createTransport()
      let bus: BusInstance
      let receivedAttributes: MessageAttributes
      let replyAttributes: MessageAttributes
      let sendSpan: ReadableSpan
      let processCommandSpan: ReadableSpan
      let publishSpan: ReadableSpan
      let processEventSpan: ReadableSpan
      let replySpan: ReadableSpan
      let processReplySpan: ReadableSpan

      beforeAll(async () => {
        const handled = new EventEmitter()
        bus = buildTracedBus({
          telemetry,
          handled,
          transport,
          reply: true,
          openTelemetryOptions: {
            messagingSystem,
            endpointName: transport.endpointName
          }
        })
        await bus.initialize()
        await bus.start()

        const commandHandled = once(
          handled,
          handledEvent(TracedCommand.NAME, runId)
        )
        const eventHandled = once(
          handled,
          handledEvent(TracedEvent.NAME, runId)
        )
        const replyHandled = once(
          handled,
          handledEvent(TracedReply.NAME, runId)
        )
        await bus.send(new TracedCommand(runId), { messageId })
        ;[receivedAttributes] = (await commandHandled) as [MessageAttributes]
        await eventHandled
        ;[replyAttributes] = (await replyHandled) as [MessageAttributes]

        sendSpan = telemetry.spanWith(
          `send ${TracedCommand.NAME}`,
          'messaging.message.id',
          messageId
        )
        processCommandSpan = telemetry.childOf(
          sendSpan,
          `process ${TracedCommand.NAME}`
        )
        const handlerSpan = telemetry.childOf(processCommandSpan, 'reserveRoom')
        publishSpan = telemetry.childOf(
          handlerSpan,
          `publish ${TracedEvent.NAME}`
        )
        processEventSpan = telemetry.childOf(
          publishSpan,
          `process ${TracedEvent.NAME}`
        )
        replySpan = telemetry.childOf(handlerSpan, `reply ${TracedReply.NAME}`)
        processReplySpan = telemetry.childOf(
          replySpan,
          `process ${TracedReply.NAME}`
        )
      })

      afterAll(async () => {
        await bus.dispose()
        await cleanUp?.(transport)
        await telemetry.shutdown()
      })

      it('should carry the trace context of the send span in the attributes', () => {
        const { traceId, spanId } = sendSpan.spanContext()
        expect(receivedAttributes.attributes.traceparent).toEqual(
          `00-${traceId}-${spanId}-01`
        )
      })

      it("should carry the reply span's trace context and the return address together on the reply", () => {
        const { traceId, spanId } = replySpan.spanContext()
        expect(replyAttributes.attributes.traceparent).toEqual(
          `00-${traceId}-${spanId}-01`
        )
        expect(replyAttributes.replyTo).toEqual(receivedAttributes.replyTo)
        expect(receivedAttributes.replyTo).toBeTruthy()
      })

      it('should send the reply to the return address, as a send operation', () => {
        expect(replySpan.attributes).toMatchObject({
          'messaging.operation.name': 'reply',
          'messaging.operation.type': 'send',
          'messaging.destination.name': receivedAttributes.replyTo
        })
      })

      it('should continue the trace in the process span of the reply', () => {
        expect(processReplySpan.spanContext().traceId).toEqual(
          sendSpan.spanContext().traceId
        )
      })

      it('should continue the trace in the process span of the command', () => {
        expect(processCommandSpan.spanContext().traceId).toEqual(
          sendSpan.spanContext().traceId
        )
        expect(processCommandSpan.attributes['messaging.message.id']).toEqual(
          messageId
        )
      })

      it('should continue the trace in the process span of the published event', () => {
        expect(processEventSpan.spanContext().traceId).toEqual(
          sendSpan.spanContext().traceId
        )
      })

      it('should name the messaging system and the queue on the process span', () => {
        expect(processCommandSpan.attributes).toMatchObject({
          'messaging.system': messagingSystem,
          'messaging.destination.name': transport.endpointName
        })
      })
    }
  )
})
