import { Command } from '@node-ts/bus-messages'

export class TestBigIntCommand extends Command {
  static NAME = '@node-ts/bus-test/test-big-int-command'
  $name = TestBigIntCommand.NAME
  $version = 0

  id: string
  amount: bigint
}
