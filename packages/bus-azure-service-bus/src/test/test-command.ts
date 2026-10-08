import { Command } from '@node-ts/bus-messages'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-azure-service-bus/test-command'
  $name = TestCommand.NAME
  $version = 0

  /**
   * @param value Identifies the command in assertions, or makes it as large as a test needs
   */
  constructor(readonly value: string) {
    super()
  }
}
