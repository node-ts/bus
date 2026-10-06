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
 * What saves workflow state and sends messages while a message is handled: one call of a handler, or one workflow
 * instance a workflow handler handles. Its identity ties the messages sent in it to the state saved in it, so a bus
 * without `withOutbox()` only sends a scope's messages early when its own state was saved.
 */
export interface UnitOfWorkScope {
  /**
   * Names the scope in logs: the handler's name, or the workflow's name and instance id
   */
  name: string
}

/**
 * An internal context that holds where the message being handled reads and saves its workflow state: its
 * transaction with `withOutbox()`, or a store that holds the saves until the outbox is flushed without it. It also
 * holds the scope that's running, a handler call or a workflow instance. Each bus has its own, shared by its
 * `BusInstance` and `WorkflowRegistry`.
 */
export class UnitOfWorkContext {
  private readonly storage = new AsyncLocalStorage<WorkflowStateStore>()
  private readonly scopes = new AsyncLocalStorage<UnitOfWorkScope>()

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

  /**
   * Gets the scope running in the current async stack, the innermost if they're nested
   * @returns the scope, or `undefined` outside a handler
   */
  currentScope(): UnitOfWorkScope | undefined {
    return this.scopes.getStore()
  }

  /**
   * Runs `fn` in a scope of its own, which the messages it sends and the state it saves are tagged with
   * @param scope the scope, such as a handler call or a workflow instance
   * @param fn the function to run
   * @returns what `fn` returns
   */
  async runInScope<T>(
    scope: UnitOfWorkScope,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.scopes.run(scope, fn)
  }
}
