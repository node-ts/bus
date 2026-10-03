import { Bus } from '@node-ts/bus-core'
import { SqsTransport } from '@node-ts/bus-sqs'
import { BusSqsLambdaReceiver } from '@node-ts/bus-sqs-lambda'
import type { SQSHandler } from 'aws-lambda'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const sqsTransport = new SqsTransport({
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(sqsTransport)
  .withHandler(reserveRoomHandler)
  // Lambda reads the queue and passes each batch to the bus
  .withReceiver(new BusSqsLambdaReceiver())
  // Lambda owns the process, so don't listen for shutdown signals
  .withInterruptSignals([])
  .build()

// Runs once per Lambda instance, when the module is loaded
await bus.initialize()

// Pass a function, rather than bus.receive itself, so it keeps its `this`
export const handler: SQSHandler = event => bus.receive(event)
