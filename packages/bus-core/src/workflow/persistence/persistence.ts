import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { OutgoingMessage } from '../../outgoing-message'
import { ClassConstructor, CoreDependencies } from '../../util'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState } from '../workflow-state'

/**
 * Infrastructure that provides the ability to persist workflow state for long running processes, and optionally
 * messages to send later.
 *
 * Workflow state is passed to and returned from the persistence as plain JSON values (Dates as ISO strings, Maps
 * as objects, Sets as arrays and bigints as strings). The bus converts it to and from its classes with its own
 * serializer and message types, so one persistence instance can be shared by several buses. A shared persistence
 * is prepared and initialized by each bus, and only disposed by the last bus that uses it.
 *
 * A persistence that implements `storeOutgoingMessages`, `claimDueOutgoingMessages` and `deleteOutgoingMessages`
 * also stores messages sent with `deliverAfter` or `deliverAt`, until a started bus sends them.
 */
export interface Persistence {
  /**
   * An optional function that is called before startup that will provide core dependencies
   * to the persistence. This can be used to fetch loggers etc that are used
   * in initialization steps. A persistence shared by several buses is prepared by each of them.
   * @param coreDependencies the dependencies of the bus that's preparing the persistence
   */
  prepare(coreDependencies: CoreDependencies): void

  /**
   * If provided, initializes the persistence implementation. This is where database connections are
   * started.
   */
  initialize?(): Promise<void>

  /**
   * If provided, will dispose any resources related to the persistence. This is where things like
   * closing database connections should occur.
   */
  dispose?(): Promise<void>

  /**
   * Allows the persistence implementation to set up its internal structure to support the workflow state
   * that it will be persisting. Typically for a database this could mean setting up the internal table
   * schema to support persisting of each of the workflow state models.
   */
  initializeWorkflow<TWorkflowState extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void>

  /**
   * Retrieves all workflow state models that match the given `messageMap` criteria
   * @param workflowStateConstructor The workflow model type to retrieve
   * @param messageMap How the message is mapped to workflow state models
   * @param message The message to map to workflow state
   * @param includeCompleted If completed workflow state items should also be returned. False by default
   * @returns the matching workflow state as it was saved. The bus restores its classes, so it doesn't need to be
   * converted.
   */
  getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    messageOptions: MessageAttributes,
    includeCompleted?: boolean
  ): Promise<WorkflowStateType[]>

  /**
   * Saves a new workflow state model or updates an existing one. Persistence implementations should take care
   * to observe the change in `$version` of the workflow state model when persisting to ensure race conditions
   * don't occur.
   * @param workflowState the workflow state as plain JSON values, ready to store as it is
   */
  saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void>

  /**
   * Whether what's stored survives a restart of the process. A bus logs a warning on its first delayed send when
   * this is `false`, since messages scheduled with `deliverAfter` or `deliverAt` are lost on restart.
   * @default undefined, which is treated as durable
   */
  readonly durable?: boolean

  /**
   * If provided, stores messages for the bus to send later, such as those sent with `deliverAfter` or
   * `deliverAt`. Without it, those sends throw `DelayedDeliveryNotSupported`. Implement it together with
   * `claimDueOutgoingMessages` and `deleteOutgoingMessages`.
   *
   * Any started bus that uses the same store sends the messages through its own transport, so every bus that shares
   * a store must use the same broker.
   *
   * Storing a message whose `id` is already stored leaves the stored message as it is, so storing the same messages
   * again doesn't send them twice. A message stored with a `leaseUntil` isn't claimed until then.
   * @param outgoingMessages the messages to store. `message`, `attributes` and `headers` are plain JSON, to store as
   * they are.
   * @returns the ids of the messages that weren't stored, because a message with the same id already was
   */
  storeOutgoingMessages?(outgoingMessages: OutgoingMessage[]): Promise<string[]>

  /**
   * If provided, claims stored messages that are due, so that only the caller sends them. A message can be claimed
   * when its `dueAt` has passed and it isn't held by a lease. Each claim adds one to the message's `attempts`, and
   * leases it for `leaseMs` times its `attempts`, up to `maxLeaseMs`, so a message that keeps failing, such as one
   * the broker rejects, is tried less often. It isn't returned by another claim while the lease holds, and is
   * returned again after that if it hasn't been deleted, such as when the process that claimed it stopped or failed
   * to send it. A message is never deleted by a claim, however many times it's been claimed.
   *
   * Times are compared with the store's own clock, such as the database's, so processes whose clocks differ agree on
   * when a message is due and when its lease ends. Claims from several processes at once must never return the same
   * message while its lease holds.
   * @param limit the most messages to return
   * @param leaseMs how long the caller has to send and delete a message claimed for the first time
   * @param maxLeaseMs the longest a message is leased for, however many times it's been claimed
   * @param now the time to claim at instead of the store's clock, such as in a test
   * @returns up to `limit` claimed messages, choosing those that have been claimable longest, ordered by `dueAt`.
   * Each is as it was stored, with its `attempts`.
   */
  claimDueOutgoingMessages?(
    limit: number,
    leaseMs: number,
    maxLeaseMs: number,
    now?: Date
  ): Promise<OutgoingMessage[]>

  /**
   * If provided, deletes stored messages once they've been sent. An id that isn't stored is ignored.
   * @param ids the `id` of each message to delete
   */
  deleteOutgoingMessages?(ids: string[]): Promise<void>
}
