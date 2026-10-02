import { Bus } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { DocumentUploaded } from './messages'

// #region s3-event
/**
 * The notification S3 publishes each time an object is created
 */
export interface S3ObjectCreatedNotification {
  Records: {
    eventSource: 'aws:s3'
    eventName: string
    s3: { object: { key: string } }
  }[]
}
// #endregion s3-event

// #region custom-handler
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withCustomHandler(
    async (notification: S3ObjectCreatedNotification, _attributes, ctx) => {
      // Publish your own event, so the rest of the app doesn't depend on S3's format
      for (const record of notification.Records) {
        await ctx.publish(new DocumentUploaded(record.s3.object.key))
      }
    },
    {
      // Called for every message read from the queue, which could be
      // anything, so check its shape

      resolveWith: notification =>
        Array.isArray(notification.Records) &&
        notification.Records[0]?.eventSource === 'aws:s3',
      // Subscribes the service queue to the topic S3 publishes to
      topicIdentifier: 'arn:aws:sns:us-east-1:000000000000:s3-object-created'
    }
  )
  .build()

await bus.initialize()
await bus.start()
// #endregion custom-handler
