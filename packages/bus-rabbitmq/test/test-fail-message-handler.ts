import { HandlesMessage, BUS_SYMBOLS, Bus } from '@node-ts/bus-core'
import { TestFailMessage } from './test-fail-message'
import { inject } from 'inversify'

@HandlesMessage(TestFailMessage)
export class TestFailMessageHandler {

  constructor (
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus
  ) {
  }

  async handle (_: TestFailMessage): Promise<void> {
    await this.bus.fail()
  }
}
