import { Command } from '@node-ts/bus-messages'

/**
 * A command used to check that message attributes survive the SNS to SQS round trip. It has its own topic so
 * it isn't delivered to queues used by other tests.
 */
export class AttributeRoundTripCommand extends Command {
  static NAME = '@node-ts/bus-sqs/attribute-round-trip-command'
  $name = AttributeRoundTripCommand.NAME
  $version = 0
}
