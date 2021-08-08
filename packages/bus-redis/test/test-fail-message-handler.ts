import { Bus } from '@node-ts/bus-core'

export class TestFailMessageHandler {
  async handle (): Promise<void> {
    await Bus.fail()
  }
}
