import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from './test-command'

export interface HandleChecker {
  check (attributes: MessageAttributes): void
}

export const testCommandHandler = (handleChecker: HandleChecker) =>
  (_: TestCommand, messageAttributes: MessageAttributes) => handleChecker.check(messageAttributes)
