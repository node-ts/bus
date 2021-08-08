import { HandleChecker } from './handler-checker'
import { HandlerContext } from '@node-ts/bus-core'
import { TestCommand } from './test-command'

export class TestCommandHandler {

  constructor (
    private readonly handleChecker: HandleChecker
  ) {
  }

  async handle ({ message, attributes }: HandlerContext<TestCommand>): Promise<void> {
    this.handleChecker.check(message, attributes)
  }
}
