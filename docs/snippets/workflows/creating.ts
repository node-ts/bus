import {
  Bus,
  defineWorkflow,
  Workflow,
  WorkflowMapper
} from '@node-ts/bus-core'
import { messageTypes } from '../message-types.generated'
import { ItemPurchased } from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

// #region function
export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  // Handlers are added with startedBy and when
  .startedBy(ItemPurchased, ({ itemId, customerId }) => ({
    itemId,
    customerId
  }))
// #endregion function

// #region class
export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper.withState(FulfilmentWorkflowState).startedBy(ItemPurchased, 'start')
  }

  start({ itemId, customerId }: ItemPurchased) {
    return { itemId, customerId }
  }
}
// #endregion class

// #region register
const bus = Bus.configure()
  // Generated from the messages and the workflow state
  .withMessageTypes(messageTypes)
  .withWorkflow(fulfilmentWorkflow)
  .build()
// #endregion register

await bus.initialize()
