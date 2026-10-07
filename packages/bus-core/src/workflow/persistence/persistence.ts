import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { OutgoingMessage, OutgoingMessageClaim } from '../../outgoing-message'
import { ProvisioningPlan } from '../../provisioning'
import { ClassConstructor, CoreDependencies } from '../../util'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState } from '../workflow-state'
import { PersistenceTransaction } from './persistence-transaction'

/**
 * A workflow state a persistence stores, and the fields of it that messages look it up by
 */
export interface PersistedWorkflow {
  /**
   * The class of the workflow state
   */
  workflowStateType: ClassConstructor<WorkflowState>

  /**
   * How each message the workflow handles is mapped to its state. Each `mapsTo` field is looked up by
   * `getWorkflowState`, so a database typically indexes it.
   */
  messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
}

export interface PersistenceInitializationOptions {
  /**
   * The workflow state the bus stores in the persistence. A persistence shared by several buses is initialized by
   * each of them, with its own workflows.
   */
  workflows: PersistedWorkflow[]

  /**
   * Whether to check that everything the persistence needs exists, such as its tables and indexes, and throw
   * `ResourcesNotProvisioned` if anything doesn't. Use read-only calls, and create nothing. It's `false` when the
   * bus was configured with `withResourceVerification(false)`, or has just provisioned.
   */
  verifyResources: boolean

  /**
   * Whether the bus is configured with `withOutbox()`, so it will begin transactions with `beginTransaction()`. A
   * persistence whose database only supports transactions in some deployments, such as MongoDB on a replica set,
   * checks it can run them here, so the bus fails at startup rather than on its first message.
   * @default false
   */
  outbox?: boolean
}

export interface PersistenceProvisionOptions {
  /**
   * The workflow state the bus stores in the persistence
   */
  workflows: PersistedWorkflow[]

  /**
   * Only work out the plan, without connecting to the database or changing anything
   */
  dryRun: boolean
}

/**
 * Infrastructure that provides the ability to persist workflow state for long running processes, and optionally
 * messages to send later.
 *
 * Workflow state is passed to and returned from the persistence as plain JSON values (Dates as ISO strings, Maps
 * as objects, Sets as arrays and bigints as strings). The bus converts it to and from its classes with its own
 * serializer and message types, so one persistence instance can be shared by several buses. A shared persistence
 * is prepared and initialized by each bus, and only disposed by the last bus that uses it.
 *
 * A persistence that implements `storeOutgoingMessages`, `claimDueOutgoingMessages`, `deleteOutgoingMessages` and
 * `releaseOutgoingMessages` also stores messages sent with `deliverAfter` or `deliverAt`, until a started bus sends
 * them.
 *
 * A persistence that also implements `beginTransaction` and `removeIncomingMessagesBefore` can be used with
 * `withOutbox()`, which saves the workflow state and outgoing messages of each message handled in one transaction,
 * and records each message in it so a copy of the message isn't handled again.
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
   * If provided, initializes the persistence implementation. This is where database connections are started. It
   * must not create anything: when `verifyResources` is set, it checks the tables, collections and indexes of the
   * workflows, and of outgoing messages if it stores them, exist, with read-only calls, and throws
   * `ResourcesNotProvisioned` naming each one that's missing.
   * @param options the workflow state the bus stores, and whether to check its storage exists
   * @throws ResourcesNotProvisioned if `verifyResources` is set and something the bus needs doesn't exist
   */
  initialize?(options: PersistenceInitializationOptions): Promise<void>

  /**
   * If provided, creates everything the persistence needs, such as a schema, a table for each workflow state with
   * indexes on the fields its messages look it up by, and a table of outgoing messages. It's run with deploy
   * credentials by `bus.provision()` (and `bus provision` from @node-ts/bus-cli), or when the bus initializes if
   * it's configured with `withAutoProvision()`. It connects to the database itself, unless it's a dry run.
   *
   * It must be idempotent: running it again, or from several processes at once, leaves what exists as it is and
   * creates what's missing.
   * @param options the workflow state the bus stores, and whether it's a dry run
   * @returns what the persistence provisions, and the permissions it needs at runtime
   */
  provision?(options: PersistenceProvisionOptions): Promise<ProvisioningPlan>

  /**
   * If provided, will dispose any resources related to the persistence. This is where things like
   * closing database connections should occur.
   */
  dispose?(): Promise<void>

  /**
   * Retrieves all workflow state models that match the given `messageMap` criteria. When the lookup returns no
   * value (`undefined`, `null` or `''`, see `hasLookupValue`) nothing matches, so return an empty array without
   * querying, rather than matching state whose mapped field is missing or empty.
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
   * `claimDueOutgoingMessages`, `deleteOutgoingMessages` and `releaseOutgoingMessages`.
   *
   * Any started bus that uses the same store sends the messages through its own transport, so every bus that shares
   * a store must use the same broker.
   *
   * Storing a message whose `id` is already stored leaves the stored message as it is, so storing the same messages
   * again doesn't send them twice. A message stored with a `leaseMs` isn't claimed until that long after it's stored, by the store's clock, unless it's released.
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

  /**
   * If provided, makes claimed messages claimable again straight away, and takes back the attempt their claim
   * counted, so they're claimed as if that claim hadn't happened. The bus calls it for messages it claimed but didn't
   * try to send, such as the rest of a batch when sending pauses, and with `attempts` of 0 for messages it stored with
   * a `leaseMs` but couldn't send straight away, so they're claimed on the next check rather than when the lease
   * ends.
   *
   * Only a message whose `attempts` still match its claim is released. If its lease ended and another process
   * claimed it since, that claim counted another attempt, so the release leaves it alone. A message that isn't
   * stored is ignored.
   * @param claims the `id` of each message to release, and its `attempts` as the claim returned it
   */
  releaseOutgoingMessages?(claims: OutgoingMessageClaim[]): Promise<void>

  /**
   * If provided, begins a transaction that workflow state is saved in, and outgoing messages stored in, until it's
   * committed. A bus configured with `withOutbox()` needs it, together with the methods that store outgoing
   * messages and `removeIncomingMessagesBefore`, and begins one for each message it handles and each
   * `bus.transaction()`.
   * @returns the transaction, which holds what it needs, such as a database connection, until the bus commits it or
   * rolls it back
   */
  beginTransaction?(): Promise<PersistenceTransaction>

  /**
   * If provided, removes the inbox's records of handled messages, made by `PersistenceTransaction.recordIncomingMessage`,
   * that were recorded before a time. A bus configured with `withOutbox()` needs it, together with `beginTransaction`.
   * A started bus configured with `withOutbox()`, or a scheduler, calls it every hour, outside any transaction, to
   * remove records older than the inbox keeps them, so a copy of a message delivered after that is handled again. It's
   * called again while it removes `limit` records, so remove at most that many in one short statement. If the
   * records' table or collection doesn't exist, there's nothing to remove.
   * @param before records made before this time are removed
   * @param limit the most records to remove
   * @returns how many records were removed
   */
  removeIncomingMessagesBefore?(before: Date, limit: number): Promise<number>
}
