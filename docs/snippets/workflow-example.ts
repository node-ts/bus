import { Bus } from '@node-ts/bus-core'
import {
  emailReceiptHandler,
  shipItemHandler
} from './handlers/fulfilment-handlers'
import { messageTypes } from './message-types.generated'
import { ItemPurchased } from './messages'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const bus = Bus.configure()
  // Includes the workflow state, so its Dates are restored when it's read
  .withMessageTypes(messageTypes)
  .withWorkflow(fulfilmentWorkflow)
  // In a real system these would usually run in other services
  .withHandler(shipItemHandler, emailReceiptHandler)
  .build()

await bus.initialize()
await bus.start()

await bus.publish(new ItemPurchased('item-1', 'customer-1'))
