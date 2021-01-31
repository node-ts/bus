import { Handler, HandlerContext } from '@node-ts/bus-core'
import { MessageAttributeMap } from '@node-ts/bus-messages'
import { TestCommand } from './test-command'

export interface HandleChecker {
  check (attributes: MessageAttributeMap): void
}

export const testCommandHandler = (handleChecker: HandleChecker): Handler<TestCommand> =>
  ({ attributes }: HandlerContext<TestCommand>) => handleChecker.check(attributes.attributes)
