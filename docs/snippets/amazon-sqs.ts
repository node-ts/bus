// #region usage
import { Bus } from '@node-ts/bus-core'
import { SqsTransport, SqsTransportConfiguration } from '@node-ts/bus-sqs'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

// #region configure
const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter'
}
const sqsTransport = new SqsTransport(sqsConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(sqsTransport)
  .withHandler(reserveRoomHandler)
  // For local development: creates the queues, topics and subscriptions when the bus initializes. In production,
  // create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
// #endregion configure
// #endregion usage

// #region existing-resources
// Queues, topics and subscriptions created elsewhere, e.g. with CDK or Terraform. initialize() checks they exist.
new SqsTransport({
  queueArn: 'arn:aws:sqs:us-east-1:000000000000:reservations-service',
  deadLetterQueueArn:
    'arn:aws:sqs:us-east-1:000000000000:reservations-service-dead-letter'
})
// #endregion existing-resources
