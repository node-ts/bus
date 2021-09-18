import { MessageAttributes } from '@node-ts/bus-messages'
import { TestEvent } from './test-event'
import { MessageLogger } from './test-event-handler'

export class TestEventClassHandler {

  constructor (
    private readonly messageLogger: MessageLogger
  ) {
  }

  async handle (message: TestEvent, attributes: MessageAttributes): Promise<void> {
    this.messageLogger.log(message)
    this.messageLogger.log(attributes)
  }
}
