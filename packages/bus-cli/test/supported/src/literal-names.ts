import { Message } from './base.js'

export class Ping extends Message {
  readonly $name = 'fixture/ping'
  $version = 0
}

const PONG = 'fixture/pong'

export class Pong extends Message {
  $name = PONG as string
  $version = 0
  sentAt: Date
}

/**
 * A workflow state, which has a $name like a message
 */
export class OrderState {
  $name = 'fixture/order-state'
  startedAt: Date
}

/**
 * Not exported, and not used by a message, so it's left out with a warning
 */
class Internal {
  $name = 'fixture/internal'
}

export const internal = new Internal()
