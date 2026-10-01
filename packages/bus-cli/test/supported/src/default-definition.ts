import { defineEvent } from '@node-ts/bus-messages'

/**
 * A definition that is the default export of its module
 */
export default defineEvent('fixture/default-event')<{ happenedAt: Date }>()
