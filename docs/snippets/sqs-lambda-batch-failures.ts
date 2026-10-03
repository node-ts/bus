import { Bus } from '@node-ts/bus-core'
import { SqsTransport } from '@node-ts/bus-sqs'
import { BusSqsLambdaReceiver } from '@node-ts/bus-sqs-lambda'
import type { SQSBatchResponse, SQSHandler } from 'aws-lambda'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(
    new SqsTransport({
      awsRegion: process.env.AWS_REGION,
      awsAccountId: process.env.AWS_ACCOUNT_ID,
      queueName: 'reservations-service'
    })
  )
  .withHandler(reserveRoomHandler)
  .withReceiver(new BusSqsLambdaReceiver({ reportBatchItemFailures: true }))
  .withInterruptSignals([])
  .build()

await bus.initialize()

// Resolves with the records that failed, so Lambda only retries those
export const handler: SQSHandler = event => bus.receive<SQSBatchResponse>(event)
