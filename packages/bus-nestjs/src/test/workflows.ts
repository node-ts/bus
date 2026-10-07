import { Inject, Injectable } from '@nestjs/common'
import { defineWorkflow, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { BusWorkflow } from '../bus-workflow'
import { FulfilmentState } from './fulfilment-state'
import { OrderPlaced } from './order-placed'
import { Recorder } from './recorder'
import { ShippingState } from './shipping-state'

/**
 * A class workflow found by `@BusWorkflow()`, which records with a provider it's given
 */
export class FulfilmentWorkflow extends Workflow<FulfilmentState> {
  constructor(private readonly recorder: Recorder) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentState, FulfilmentWorkflow>
  ): void {
    mapper.withState(FulfilmentState).startedBy(OrderPlaced, 'start')
  }

  async start(event: OrderPlaced): Promise<Partial<FulfilmentState>> {
    this.recorder.record({ by: FulfilmentWorkflow.name, message: event })
    return { orderId: event.orderId }
  }
}
Injectable()(FulfilmentWorkflow)
Inject(Recorder)(FulfilmentWorkflow, undefined, 0)
BusWorkflow()(FulfilmentWorkflow)

/**
 * A function workflow registered with `BusModule.forFeatureAsync()`, which closes over the recorder it's given
 */
export const shippingWorkflow = (recorder: Recorder) =>
  defineWorkflow(ShippingState).startedBy(OrderPlaced, async event => {
    recorder.record({ by: 'shippingWorkflow', message: event })
    return { orderId: event.orderId }
  })
