import { Handler } from '../handler'
import { TestCommand } from './test-command'
import { MessageLogger } from './test-event-handler'

/**
 * A class handler that declares `messageType` as a getter, and that needs its dependency to be constructed
 */
export class TestCommandGetterClassHandler implements Handler<TestCommand> {
  get messageType() {
    return TestCommand
  }

  constructor(private readonly messageLogger: MessageLogger) {
    this.messageLogger.log('TestCommandGetterClassHandler constructed')
  }

  async handle(message: TestCommand): Promise<void> {
    this.messageLogger.log(message)
  }
}
