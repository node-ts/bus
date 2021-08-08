import { TestSystemMessage } from './test-system-message'
import { HandleChecker } from './handler-checker'
import { HandlerContext } from '@node-ts/bus-core'

export class TestSystemMessageHandler {

  constructor (
    private readonly handleChecker: HandleChecker
  ) {
  }

  async handle ({ message, attributes }: HandlerContext<TestSystemMessage>): Promise<void> {
    this.handleChecker.check(message, attributes)
  }
}
