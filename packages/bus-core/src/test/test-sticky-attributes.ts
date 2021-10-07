import { Bus } from '../service-bus/bus'
import { TestEvent } from './test-event'

export const testStickAttributesTestCommand = async () => {
  await Bus.send(new TestEvent())
}
