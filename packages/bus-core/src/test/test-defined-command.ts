import { defineCommand, MessageOf } from '@node-ts/bus-messages'

/**
 * A command declared with defineCommand rather than a class
 */
export const TestDefinedCommand = defineCommand(
  '@node-ts/bus-core/test-defined-command'
)<{ orderId: string; placedAt: Date }>()
export type TestDefinedCommand = MessageOf<typeof TestDefinedCommand>
