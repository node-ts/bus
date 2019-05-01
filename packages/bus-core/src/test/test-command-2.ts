import { Command } from '@node-ts/bus-messages'

export class TestCommand2 extends Command {
  static NAME = '@node-ts/bus-core/test-command-2'
  $name = TestCommand2.NAME
  $version = 1
}
