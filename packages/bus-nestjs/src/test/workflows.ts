import { Inject, Injectable, Scope } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { defineWorkflow, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { BusRequest } from '../bus-request'
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

/**
 * A request-scoped class workflow that reads the message from `REQUEST` in its constructor, which fails when the
 * bus creates it without a message to read its `configureWorkflow()`
 */
export class RequestScopedWorkflow extends Workflow<FulfilmentState> {
  readonly orderId: string

  constructor(request: BusRequest) {
    super()
    this.orderId = (request.message as OrderPlaced).orderId
  }

  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentState, RequestScopedWorkflow>
  ): void {
    mapper.withState(FulfilmentState).startedBy(OrderPlaced, 'start')
  }

  async start(): Promise<Partial<FulfilmentState>> {
    return { orderId: this.orderId }
  }
}
Injectable({ scope: Scope.REQUEST })(RequestScopedWorkflow)
Inject(REQUEST)(RequestScopedWorkflow, undefined, 0)
