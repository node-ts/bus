import { HandlesMessage } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from './test-command'
import { inject } from 'inversify'

export const HANDLE_CHECKER = Symbol.for('node-ts/bus-sqs/integration/handle-checker')
export interface HandleChecker {
  check<T extends Object> (message: T, attributes: MessageAttributes): void
}

@HandlesMessage(TestCommand)
export class TestCommandHandler {

  constructor (
    @inject(HANDLE_CHECKER) private readonly handleChecker: HandleChecker
  ) {
  }

  async handle (
    command: TestCommand,
    messageAttributes: MessageAttributes
  ): Promise<void> {
    this.handleChecker.check(command, messageAttributes)
  }
}
