import { SNSClient } from '@aws-sdk/client-sns'
import {
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  Message as SqsMessage
} from '@aws-sdk/client-sqs'
import {
  Bus,
  BusInstance,
  HandlerDispatchRejected,
  handlerFor,
  Logger,
  ReceivedMessageReturnedToQueue,
  RetryStrategy
} from '@node-ts/bus-core'
import { SqsTransport } from '@node-ts/bus-sqs'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { Mock } from 'typemoq'
import { BusSqsLambdaReceiver } from './bus-sqs-lambda-receiver'
import { BusSqsLambdaReceiverConfiguration } from './bus-sqs-lambda-receiver-configuration'
import {
  TestCommand,
  TestCommandOutcome,
  toLambdaRecord,
  UnhandledCommand
} from './test'

jest.setTimeout(60000)

// Overridable so CI and contributors can point at LocalStack on a different host/port
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'
const AWS_REGION = process.env.AWS_REGION!
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!

/**
 * How long a record read by the simulated Lambda stays invisible. Records that fail without being returned
 * reappear once it expires, as they do when a real Lambda invocation fails.
 */
const VISIBILITY_TIMEOUT_SECONDS = 2
const MESSAGE_WAIT_MS = 10000

// Returned messages become visible again straight away so the test doesn't wait on the retry backoff
const immediateRetryStrategy: RetryStrategy = {
  calculateRetryDelay: () => 0
}

const sqs = new SQSClient({ endpoint: LOCALSTACK_ENDPOINT, region: AWS_REGION })
const sns = new SNSClient({ endpoint: LOCALSTACK_ENDPOINT, region: AWS_REGION })

interface ReadMessage {
  id: string
  sqsMessage: SqsMessage
}

/**
 * Reads messages from the queue until `count` have arrived, or until `waitMs` passes when no count is given
 */
const readMessages = async (
  queueUrl: string,
  { count, waitMs }: { count?: number; waitMs: number }
): Promise<ReadMessage[]> => {
  const messages: ReadMessage[] = []
  const deadline = Date.now() + waitMs
  while (
    Date.now() < deadline &&
    (count === undefined || messages.length < count)
  ) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
        MessageSystemAttributeNames: ['All'],
        MessageAttributeNames: ['All']
      })
    )
    Messages.forEach(sqsMessage => {
      const { id } = JSON.parse(JSON.parse(sqsMessage.Body!).Message)
      messages.push({ id, sqsMessage })
    })
  }
  return messages
}

const deleteMessages = async (queueUrl: string, messages: SqsMessage[]) =>
  Promise.all(
    messages.map(message =>
      sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        })
      )
    )
  )

/**
 * Reads every message that comes back to the queue and deletes it, returning the ids of the messages
 */
const drainQueue = async (queueUrl: string): Promise<string[]> => {
  // Wait past the visibility timeout so that failed records have had the chance to reappear
  const messages = await readMessages(queueUrl, {
    waitMs: (VISIBILITY_TIMEOUT_SECONDS + 3) * 1000
  })
  await deleteMessages(
    queueUrl,
    messages.map(m => m.sqsMessage)
  )
  return [...new Set(messages.map(m => m.id))].sort()
}

/**
 * Sends a batch where one message succeeds, one throws, one is returned with bus.returnMessage() and one has no
 * handler, then reads it off the real queue and returns it as a Lambda would deliver it.
 */
const sendBatch = async (
  bus: BusInstance,
  transport: SqsTransport,
  prefix: string
): Promise<{ event: SQSEvent; messages: ReadMessage[] }> => {
  await Promise.all([
    bus.send(new TestCommand(`${prefix}-succeed`, TestCommandOutcome.Succeed)),
    bus.send(new TestCommand(`${prefix}-throw`, TestCommandOutcome.Throw)),
    bus.send(new TestCommand(`${prefix}-return`, TestCommandOutcome.Return)),
    // No handler means no topic subscription, so deliver it to the queue in an SNS envelope directly
    sqs.send(
      new SendMessageCommand({
        QueueUrl: transport.queueUrl,
        MessageBody: JSON.stringify({
          Message: JSON.stringify(new UnhandledCommand(`${prefix}-unhandled`)),
          MessageAttributes: {}
        })
      })
    )
  ])

  const messages = await readMessages(transport.queueUrl, {
    count: 4,
    waitMs: MESSAGE_WAIT_MS
  })
  return {
    event: { Records: messages.map(m => toLambdaRecord(m.sqsMessage)) },
    messages
  }
}

const buildBus = async (
  queueName: string,
  configuration?: BusSqsLambdaReceiverConfiguration
): Promise<{ bus: BusInstance; transport: SqsTransport }> => {
  const transport = new SqsTransport(
    {
      awsRegion: AWS_REGION,
      awsAccountId: AWS_ACCOUNT_ID,
      queueName,
      deadLetterQueueName: `${queueName}-dead-letter`
    },
    sqs,
    sns
  )
  const bus: BusInstance = Bus.configure()
    .withTransport(transport)
    .withReceiver(new BusSqsLambdaReceiver(configuration))
    .withRetryStrategy(immediateRetryStrategy)
    .withHandler(
      handlerFor(TestCommand, async (command: TestCommand) => {
        if (command.outcome === TestCommandOutcome.Throw) {
          throw new Error('Handler failed')
        }
        if (command.outcome === TestCommandOutcome.Return) {
          await bus.returnMessage()
        }
      })
    )
    .withLogger(() => Mock.ofType<Logger>().object)
    .build()
  await bus.initialize()
  return { bus, transport }
}

const disposeBus = async (bus: BusInstance, transport: SqsTransport) => {
  await bus.dispose()
  await sqs.send(new DeleteQueueCommand({ QueueUrl: transport.queueUrl }))
  await sqs.send(
    new DeleteQueueCommand({ QueueUrl: transport.deadLetterQueueUrl })
  )
}

describe('BusSqsLambdaReceiver', () => {
  describe('when a batch is received from a real SQS queue', () => {
    describe('with reportBatchItemFailures enabled', () => {
      const prefix = 'report'
      let bus: BusInstance
      let transport: SqsTransport
      let messages: ReadMessage[]
      let response: SQSBatchResponse
      let messagesThatCameBack: string[]
      const failedMessageIds: string[] = []

      beforeAll(async () => {
        ;({ bus, transport } = await buildBus(
          'integration-bus-sqs-lambda-report',
          { reportBatchItemFailures: true }
        ))
        const batch = await sendBatch(bus, transport, prefix)
        messages = batch.messages

        bus.onError.on(({ message }) =>
          failedMessageIds.push((message as TestCommand).id)
        )
        response = await bus.receive<SQSBatchResponse>(batch.event)

        // Lambda deletes every record that isn't listed as a failure
        const failedIds = response.batchItemFailures.map(f => f.itemIdentifier)
        await deleteMessages(
          transport.queueUrl,
          messages
            .map(m => m.sqsMessage)
            .filter(m => !failedIds.includes(m.MessageId!))
        )
        messagesThatCameBack = await drainQueue(transport.queueUrl)
      })

      afterAll(async () => {
        await disposeBus(bus, transport)
      })

      it('should read the whole batch from the queue', () => {
        expect(messages.map(m => m.id).sort()).toEqual([
          `${prefix}-return`,
          `${prefix}-succeed`,
          `${prefix}-throw`,
          `${prefix}-unhandled`
        ])
      })

      it('should report only the thrown and returned records as failures', () => {
        const idsBySqsMessageId = new Map(
          messages.map(m => [m.sqsMessage.MessageId, m.id])
        )
        expect(
          response.batchItemFailures
            .map(f => idsBySqsMessageId.get(f.itemIdentifier))
            .sort()
        ).toEqual([`${prefix}-return`, `${prefix}-throw`])
      })

      it('should return the returned record to SQS without error, using the Lambda receipt handle', () => {
        expect(failedMessageIds).toEqual([`${prefix}-throw`])
      })

      it('should delete the successful and unhandled records and return the failed ones to the queue', () => {
        expect(messagesThatCameBack).toEqual([
          `${prefix}-return`,
          `${prefix}-throw`
        ])
      })
    })

    describe('without reportBatchItemFailures enabled', () => {
      const prefix = 'batch'
      let bus: BusInstance
      let transport: SqsTransport
      let error: unknown
      let messagesThatCameBack: string[]

      beforeAll(async () => {
        ;({ bus, transport } = await buildBus(
          'integration-bus-sqs-lambda-batch'
        ))
        const { event } = await sendBatch(bus, transport, prefix)

        // Lambda deletes nothing when the invocation fails
        error = await bus.receive(event).catch(e => e)
        messagesThatCameBack = await drainQueue(transport.queueUrl)
      })

      afterAll(async () => {
        await disposeBus(bus, transport)
      })

      it('should reject with a record failure so that Lambda retries the whole batch', () => {
        // The first failed record in the batch decides the error, and SQS doesn't guarantee the order
        const recordFailures = [
          HandlerDispatchRejected,
          ReceivedMessageReturnedToQueue
        ]
        expect(recordFailures.some(failure => error instanceof failure)).toBe(
          true
        )
      })

      it('should return the whole batch to the queue', () => {
        expect(messagesThatCameBack).toEqual([
          `${prefix}-return`,
          `${prefix}-succeed`,
          `${prefix}-throw`,
          `${prefix}-unhandled`
        ])
      })
    })
  })
})
