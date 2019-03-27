import { HandlesMessage } from '../handler/handles-message'
import { TestCommand } from './test-command'

@HandlesMessage(TestCommand)
export class TestCommandHandler {
  async handle (_: TestCommand): Promise<void> {
    // NOOP
  }
}
