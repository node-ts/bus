import { Command } from '@node-ts/bus-messages'

export class UnhandledCommand extends Command {
  static NAME = '@node-ts/bus-sqs-lambda/unhandled-command'
  $name = UnhandledCommand.NAME
  $version = 0
}
