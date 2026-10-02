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
  .build()

// Creates the queues and topics, and subscribes the queue to each handled message's topic
await bus.initialize()
await bus.start()
// #endregion configure

// #region existing-resources
// Queues, topics and subscriptions are created elsewhere, e.g. with CDK or Terraform
new SqsTransport({
  queueArn: 'arn:aws:sqs:us-east-1:000000000000:reservations-service',
  deadLetterQueueArn:
    'arn:aws:sqs:us-east-1:000000000000:reservations-service-dead-letter',
  autoProvision: false
})
// #endregion existing-resources
