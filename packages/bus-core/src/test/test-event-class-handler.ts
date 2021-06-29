import { HandlerContext } from '../handler'
import { TestEvent } from './test-event'
import { MessageLogger } from './test-event-handler'

export class TestEventClassHandler {

  constructor (
    private readonly messageLogger: MessageLogger
  ) {
  }

  async handle ({ message, attributes }: HandlerContext<TestEvent>): Promise<void> {
    this.messageLogger.log(message)
    this.messageLogger.log(attributes)
  }
}
