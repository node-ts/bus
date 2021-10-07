import { Command } from '@node-ts/bus-messages'

export class TestCommand3 extends Command {
  static NAME = '@node-ts/bus-core/test-command-3'
  $name = TestCommand3.NAME
  $version = 1
}
