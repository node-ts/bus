import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { HandleChecker } from './handle-checker'

export const testSystemMessageHandler =
  (handleChecker: HandleChecker) =>
  async (message: Message, attributes: MessageAttributes) =>
    handleChecker.check(message, attributes)
