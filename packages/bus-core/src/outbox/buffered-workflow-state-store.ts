import { Persistence } from '../workflow/persistence'
import { WorkflowState } from '../workflow/workflow-state'
import { WorkflowStateStore } from './unit-of-work-context'

/**
 * What applying the held workflow state saves did
 */
export interface AppliedWorkflowStateSaves<TSavedBy> {
  /**
   * The handler calls whose saves were all, or partly, kept before a save failed. Their messages should still be
   * sent, since a retry would find their state saved and could skip sending them.
   */
  savedBy: Set<TSavedBy>
  /**
   * The error of the save that failed, after which no more were made, if one did
   */
  failure: { error: unknown } | undefined
}

/**
 * Holds the workflow state a message's handlers save, on a bus without `withOutbox()`, until the outbox is flushed.
 * The saves are applied just before the outbox's messages are sent, so a handler that fails drops the state changes
 * with the messages, and the retry makes both again. Reads go to the persistence.
 *
 * Each save is tagged with the handler call that made it, so that when a save fails part way through, the bus can
 * still send the messages of the handlers whose state was kept.
 */
export class BufferedWorkflowStateStore<
  TSavedBy
> implements WorkflowStateStore {
  private pendingSaves: {
    workflowState: WorkflowState
    savedBy: TSavedBy | undefined
  }[] = []

  /**
   * @param persistence where the state is read, and saved once the saves are applied
   * @param currentHandlerCall gets the handler call that's saving, in the current async context
   */
  constructor(
    private readonly persistence: Persistence,
    private readonly currentHandlerCall: () => TSavedBy | undefined
  ) {}

  getWorkflowState: Persistence['getWorkflowState'] = async (...args) =>
    this.persistence.getWorkflowState(...args)

  async saveWorkflowState<TWorkflowState extends WorkflowState>(
    workflowState: TWorkflowState
  ): Promise<void> {
    this.pendingSaves.push({
      workflowState,
      savedBy: this.currentHandlerCall()
    })
  }

  /**
   * Saves the held workflow state to the persistence, in the order it was saved, checking its `$version` as each is
   * saved. It stops at the first save that fails, such as one whose state was saved elsewhere since it was read.
   * There's no transaction, so the saves made before it are kept.
   * @returns the handler calls whose state was kept, and the error of the save that failed, if one did
   */
  async apply(): Promise<AppliedWorkflowStateSaves<TSavedBy>> {
    const pendingSaves = this.pendingSaves
    this.pendingSaves = []
    const savedBy = new Set<TSavedBy>()
    for (const pendingSave of pendingSaves) {
      try {
        await this.persistence.saveWorkflowState(pendingSave.workflowState)
      } catch (error) {
        return { savedBy, failure: { error } }
      }
      if (pendingSave.savedBy !== undefined) {
        savedBy.add(pendingSave.savedBy)
      }
    }
    return { savedBy, failure: undefined }
  }

  /**
   * Drops the held workflow state
   */
  discard(): void {
    this.pendingSaves = []
  }
}
