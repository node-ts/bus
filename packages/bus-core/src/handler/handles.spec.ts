import { HandlesMessage } from './handles-message'
import { TestEvent } from '../test'

@HandlesMessage(TestEvent)
class TestHandler {
  async handle (testEvent: TestEvent): Promise<void> {
    // NOOP
  }
}


describe('@Handles', () => {
  let sut: TestHandler
})
