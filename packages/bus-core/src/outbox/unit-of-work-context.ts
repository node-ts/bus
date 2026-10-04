import { AsyncLocalStorage } from 'node:async_hooks'
import { Persistence } from '../workflow/persistence'

/**
 * Where the workflow state of a message is read and saved while it's handled
 */
export type WorkflowStateStore = Pick<
  Persistence,
  'getWorkflowState' | 'saveWorkflowState'
>

/**
 * An internal context that holds where the message being handled reads and saves its workflow state: its
 * transaction with `withOutbox()`, or a store that holds the saves until the outbox is flushed without it. Each bus
 * has its own, shared by its `BusInstance` and `WorkflowRegistry`.
 */
export class UnitOfWorkContext {
  private readonly storage = new AsyncLocalStorage<WorkflowStateStore>()

  /**
   * Gets the workflow state store of the current async stack
   * @returns the store, or `undefined` outside the handling of a message
   */
  get(): WorkflowStateStore | undefined {
    return this.storage.getStore()
  }

  /**
   * Runs `fn` with a workflow state store
   * @param store where `fn` reads and saves workflow state
   * @param fn the function to run
   * @returns what `fn` returns
   */
  async run<T>(store: WorkflowStateStore, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(store, fn)
  }
}
