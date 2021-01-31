import { Handler, HandlerContext } from '@node-ts/bus-core'
import { HandleChecker } from './test-command-handler'
import { TestSystemMessage } from './test-system-message'

export const testSystemMessageHandler = (handleChecker: HandleChecker): Handler<TestSystemMessage> =>
  async ({ attributes }: HandlerContext<TestSystemMessage>) =>
    handleChecker.check(attributes.attributes)
