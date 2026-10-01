// class-transformer's @Type reads reflect metadata when the class is defined,
// so load the polyfill here rather than relying on the consumer to do it first
import 'reflect-metadata'

import { WorkflowState } from '@node-ts/bus-core'
import { Type } from 'class-transformer'
import { TestCustomer } from './test-customer'

/**
 * Workflow state with nested types, used to check that workflow state survives a round trip
 * through a persistence
 */
export class TestRoundTripWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-test/test-round-trip-workflow-state'
  $name = TestRoundTripWorkflowState.NAME

  orderId: string

  @Type(() => Date)
  startedAt: Date

  @Type(() => TestCustomer)
  customer: TestCustomer

  @Type(() => Date)
  checkpoints: Date[]
}
