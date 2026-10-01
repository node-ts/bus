import { messageTypes } from './message-types.generated.js'

export class Ping {
  $name = 'fixture/ping'
  sentAt: Date
}

export const pingTypes = messageTypes.messages['fixture/ping']
