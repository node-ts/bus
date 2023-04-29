import { Message, MessageAttributes } from '@node-ts/bus-messages'

export interface HandleChecker {
  check(message: Message, attributes: MessageAttributes): void
}
