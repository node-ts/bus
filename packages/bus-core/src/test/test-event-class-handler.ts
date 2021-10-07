import { MessageAttributes } from '@node-ts/bus-messages'
import { Handler } from '../handler'
import { TestEvent } from './test-event'
import { MessageLogger } from './test-event-handler'

export class TestEventClassHandler implements Handler<TestEvent> {
  messageType = TestEvent

  constructor (
    private readonly messageLogger: MessageLogger
  ) {
  }

  async handle (message: TestEvent, attributes: MessageAttributes): Promise<void> {
    this.messageLogger.log(message)
    this.messageLogger.log(attributes)
  }
}
