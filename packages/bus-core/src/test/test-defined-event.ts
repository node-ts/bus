import { defineEvent, MessageOf } from '@node-ts/bus-messages'

/**
 * An event declared with defineEvent rather than a class
 */
export const TestDefinedEvent = defineEvent(
  '@node-ts/bus-core/test-defined-event',
  { version: 2 }
)<{ orderId: string }>()
export type TestDefinedEvent = MessageOf<typeof TestDefinedEvent>
