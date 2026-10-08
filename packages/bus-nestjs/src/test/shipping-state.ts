import { WorkflowState } from '@node-ts/bus-core'

/**
 * The state of `shippingWorkflow`, a function workflow
 */
export class ShippingState extends WorkflowState {
  static NAME = '@node-ts/bus-nestjs/shipping-state'
  $name = ShippingState.NAME

  orderId: string
}
