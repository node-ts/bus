import { Message, MessageAttributes } from '@node-ts/bus-messages'

/**
 * A checker that handlers call, so tests can assert on handled messages with a typemoq mock
 */
export interface HandleChecker {
  check(message: Message, attributes: MessageAttributes): void
}
