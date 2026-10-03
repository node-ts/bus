import { WorkflowState } from '@node-ts/bus-core'

/**
 * The state of the workflows the tests start with a `TracedCommand`
 */
export class ReservationWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-opentelemetry/reservation-workflow-state'
  $name = ReservationWorkflowState.NAME

  runId: string
}
