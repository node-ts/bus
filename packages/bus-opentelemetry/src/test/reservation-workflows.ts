import { defineWorkflow, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { ReservationWorkflowState } from './reservation-workflow-state'
import { TracedCommand } from './traced-command'

/**
 * A class workflow started by a `TracedCommand`, whose handler spans are named after the class
 */
export class ReservationWorkflow extends Workflow<ReservationWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<ReservationWorkflowState, ReservationWorkflow>
  ): void {
    mapper.withState(ReservationWorkflowState).startedBy(TracedCommand, 'start')
  }

  async start(
    command: TracedCommand
  ): Promise<Partial<ReservationWorkflowState>> {
    return { runId: command.runId }
  }
}

/**
 * A function workflow started by a `TracedCommand`, whose handler spans are named after its state
 */
export const reservationFunctionWorkflow = defineWorkflow(
  ReservationWorkflowState
).startedBy(TracedCommand, async command => ({ runId: command.runId }))
