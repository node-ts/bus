import { BusInstance } from '../service-bus'
import { TestEvent } from './test-event'

export const testStickAttributesTestCommand = async (bus: BusInstance) => {
  await bus.send(new TestEvent())
}
