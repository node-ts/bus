import { WorkflowState } from '@node-ts/bus-core'

/**
 * The state of `FulfilmentWorkflow`, a class workflow
 */
export class FulfilmentState extends WorkflowState {
  static NAME = '@node-ts/bus-nestjs/fulfilment-state'
  $name = FulfilmentState.NAME

  orderId: string
}
