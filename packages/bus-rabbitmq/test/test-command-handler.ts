import { HandlesMessage } from '@node-ts/bus-core'
import { TestCommand } from './test-command'

@HandlesMessage(TestCommand)
export class TestCommandHandler {
  async handle (_: TestCommand): Promise<void> {
    // ...
  }
}
