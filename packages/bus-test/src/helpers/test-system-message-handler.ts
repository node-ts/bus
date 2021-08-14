import { Handler, HandlerContext } from '@node-ts/bus-core'
import { HandleChecker } from './handle-checker'
import { TestSystemMessage } from './test-system-message'

export const testSystemMessageHandler = (handleChecker: HandleChecker): Handler<TestSystemMessage> =>
  async ({ message, attributes }: HandlerContext<TestSystemMessage>) =>
    handleChecker.check(message, attributes)
