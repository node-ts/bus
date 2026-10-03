// What `bus generate-message-types` writes for a project with one message,
// CreditCardCharged, that has a Date field
import type { MessageTypes } from '@node-ts/bus-messages'
import { CreditCardCharged } from './messages/credit-card-charged'

// Pass to the bus with Bus.configure().withMessageTypes(messageTypes)
export const messageTypes: MessageTypes = {
  source: 'my-app/src/message-types.generated',
  messages: {
    'my-app/accounts/credit-card-charged':
      'my-app/src/messages/credit-card-charged#CreditCardCharged'
  },
  types: {
    'my-app/src/messages/credit-card-charged#CreditCardCharged': {
      class: CreditCardCharged,
      fields: {
        chargedAt: 'Date'
      }
    }
  }
}
