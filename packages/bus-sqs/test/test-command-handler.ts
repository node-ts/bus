import { HandlesMessage, MessageAttributes, MessageAttributes } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { inject } from 'inversify'

export interface CheckerAttributes extends MessageAttributes {
  attribute1: string
  attribute2: number
}

export interface CheckerStickyAttributes extends MessageAttributes {
  attribute1: string
  attribute2: number
}

export const HANDLE_CHECKER = Symbol.for('node-ts/bus-sqs/integration/handle-checker')
export interface HandleChecker {
  check (
    correlationId: string,
    attributes: CheckerAttributes,
    stickyAttributes: CheckerStickyAttributes
  ): void
}

@HandlesMessage(TestCommand)
export class TestCommandHandler {

  constructor (
    @inject(HANDLE_CHECKER) private readonly handleChecker: HandleChecker
  ) {
  }

  async handle (
    _: TestCommand,
    messageOptions: MessageAttributes<CheckerAttributes, CheckerStickyAttributes>
  ): Promise<void> {
    this.handleChecker.check(
      messageOptions.correlationId!,
      messageOptions.attributes!,
      messageOptions.stickyAttributes!
    )
  }
}
