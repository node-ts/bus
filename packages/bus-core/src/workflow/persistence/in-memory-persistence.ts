import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { Logger } from '../../logger'
import {
  TransactionNotActive,
  TransactionNotActiveReason
} from '../../outbox/error'
import { OutgoingMessage, OutgoingMessageClaim } from '../../outgoing-message'
import { ClassConstructor, CoreDependencies } from '../../util'
import { hasLookupValue } from '../has-lookup-value'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import {
  OutgoingMessageStoredConcurrently,
  WorkflowStateNotInitialized,
  WorkflowStateVersionConflict
} from './error'
import { Persistence, PersistenceInitializationOptions } from './persistence'
import { PersistenceTransaction } from './persistence-transaction'

interface WorkflowStorage {
  [workflowStateName: string]: WorkflowState[]
}

/**
 * A stored outgoing message and when its lease ends, if it's been claimed
 */
interface StoredOutgoingMessage {
  outgoingMessage: OutgoingMessage
  /**
   * When the message can next be claimed: its due time, or the end of its lease once it's been claimed
   */
  availableAt: number
  attempts: number
}

/**
 * Workflow state saved in a transaction that hasn't been committed
 */
interface PendingWorkflowState {
  /**
   * The state as it was saved, with its `$version` incremented
   */
  workflowState: WorkflowState
  /**
   * The `$version` of the committed state when the transaction first saved it, or `undefined` if there was none. The
   * commit fails if it's changed since.
   */
  committedVersion: number | undefined
}

/**
 * What a transaction has changed, which is applied when it's committed
 */
interface PendingChanges {
  /**
   * Saved workflow state, by `pendingKey`
   */
  workflowStates: Map<string, PendingWorkflowState>
  outgoingMessages: OutgoingMessage[]
}

const pendingKey = (workflowStateName: string, workflowId: string): string =>
  JSON.stringify([workflowStateName, workflowId])

/**
 * A non-durable in-memory persistence for storage and retrieval of workflow state, and of messages sent with
 * `deliverAfter` or `deliverAt`. Before using this, be warned that neither survives a process restart or
 * application shut down. As such this should only be used for testing, prototyping or handling unimportant
 * workflows.
 *
 * It supports `withOutbox()`. A transaction holds its changes until it's committed, then checks the workflow state it
 * saved hasn't been saved elsewhere since and applies them all at once.
 */
export class InMemoryPersistence implements Persistence {
  /**
   * Nothing it stores survives a restart, so a bus warns on its first delayed send
   */
  readonly durable = false
  private workflowState: WorkflowStorage = {}
  private outgoingMessages = new Map<string, StoredOutgoingMessage>()
  private logger: Logger

  prepare(coreDependencies: CoreDependencies): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:in-memory-persistence'
    )
  }

  /**
   * Sets up somewhere to store the state of each workflow. There's nothing to provision, so it never checks
   * anything exists. State already stored for a workflow, such as by another bus that shares this persistence, is
   * kept.
   * @param options the workflows of the bus
   */
  async initialize(options: PersistenceInitializationOptions): Promise<void> {
    for (const { workflowStateType } of options.workflows) {
      const name = new workflowStateType().$name
      this.workflowState[name] ??= []
    }
  }

  async getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted?: boolean | undefined
  ): Promise<WorkflowStateType[]> {
    return this.findWorkflowState(
      this.committedWorkflowState(new workflowStateConstructor().$name),
      messageMap,
      message,
      attributes,
      includeCompleted
    )
  }

  /**
   * Saves a copy of the workflow state with its `$version` incremented. The `$version` of the state
   * being saved must match the version held in memory, in the same way as durable persistence
   * adapters enforce optimistic concurrency.
   * @param workflowState the workflow state to save
   * @throws WorkflowStateNotInitialized if the workflow state hasn't been initialized
   * @throws WorkflowStateVersionConflict if the workflow state was saved elsewhere since it was read
   */
  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    const existingWorkflowState = this.committedWorkflowState(
      workflowState.$name
    )
    const existingIndex = existingWorkflowState.findIndex(
      d => d.$workflowId === workflowState.$workflowId
    )
    assertVersionMatches(
      workflowState,
      existingIndex >= 0
        ? existingWorkflowState[existingIndex].$version
        : undefined
    )

    const updatedWorkflowState = copyWorkflowState(workflowState)
    updatedWorkflowState.$version = workflowState.$version + 1
    if (existingIndex >= 0) {
      existingWorkflowState[existingIndex] = updatedWorkflowState
    } else {
      existingWorkflowState.push(updatedWorkflowState)
    }
  }

  async storeOutgoingMessages(
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    return this.storeOutgoing(outgoingMessages)
  }

  /**
   * Claims due messages, comparing times with this process' clock
   */
  async claimDueOutgoingMessages(
    limit: number,
    leaseMs: number,
    maxLeaseMs: number,
    now = new Date()
  ): Promise<OutgoingMessage[]> {
    const nowMs = now.getTime()
    const claimed = [...this.outgoingMessages.values()]
      .filter(({ availableAt }) => availableAt <= nowMs)
      .sort((a, b) => a.availableAt - b.availableAt)
      .slice(0, limit)
    return claimed
      .map(stored => {
        stored.attempts++
        stored.availableAt =
          nowMs + Math.min(leaseMs * stored.attempts, maxLeaseMs)
        return {
          ...copyOutgoingMessage(stored.outgoingMessage),
          attempts: stored.attempts
        }
      })
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
  }

  async deleteOutgoingMessages(ids: string[]): Promise<void> {
    ids.forEach(id => this.outgoingMessages.delete(id))
  }

  async releaseOutgoingMessages(claims: OutgoingMessageClaim[]): Promise<void> {
    for (const { id, attempts } of claims) {
      const stored = this.outgoingMessages.get(id)
      if (stored && stored.attempts === attempts) {
        stored.availableAt = stored.outgoingMessage.dueAt.getTime()
        stored.attempts = Math.max(stored.attempts - 1, 0)
      }
    }
  }

  /**
   * Begins a transaction that holds the workflow state saved and the outgoing messages stored in it until it's
   * committed. Reads in it see what it has saved.
   * @returns the transaction
   */
  async beginTransaction(): Promise<PersistenceTransaction> {
    const pending: PendingChanges = {
      workflowStates: new Map(),
      outgoingMessages: []
    }
    let isActive = true
    const assertActive = (operation: string): void => {
      if (!isActive) {
        throw new TransactionNotActive(
          operation,
          InMemoryPersistence.name,
          TransactionNotActiveReason.Ended
        )
      }
    }
    return {
      getWorkflowState: async (
        workflowStateConstructor,
        messageMap,
        message,
        attributes,
        includeCompleted
      ) => {
        assertActive('getWorkflowState')
        return this.findWorkflowState(
          this.workflowStateIn(pending, new workflowStateConstructor().$name),
          messageMap,
          message,
          attributes,
          includeCompleted
        )
      },
      saveWorkflowState: async workflowState => {
        assertActive('saveWorkflowState')
        this.saveInTransaction(pending, workflowState)
      },
      storeOutgoingMessages: async outgoingMessages => {
        assertActive('storeOutgoingMessages')
        return this.storeInTransaction(pending, outgoingMessages)
      },
      commit: async () => {
        assertActive('commit')
        isActive = false
        this.applyPendingChanges(pending)
      },
      rollback: async () => {
        assertActive('rollback')
        isActive = false
      }
    }
  }

  /**
   * Gets the number of workflow states held in memory for a workflow state type
   * @param workflowStateConstructor the type of workflow state to count
   * @returns the number of workflow states held, including completed ones
   * @throws WorkflowStateNotInitialized if the workflow state hasn't been initialized
   */
  length(workflowStateConstructor: ClassConstructor<WorkflowState>): number {
    const workflowStateName = new workflowStateConstructor().$name
    const workflowState = this.workflowState[workflowStateName]
    if (!workflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }
    return workflowState.length
  }

  /**
   * The committed workflow state of a type
   * @throws WorkflowStateNotInitialized if the workflow state hasn't been initialized
   */
  private committedWorkflowState(workflowStateName: string): WorkflowState[] {
    const workflowState = this.workflowState[workflowStateName]
    if (!workflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }
    return workflowState
  }

  /**
   * The workflow state of a type as a transaction sees it: the committed state, with what it has saved in its place
   */
  private workflowStateIn(
    pending: PendingChanges,
    workflowStateName: string
  ): WorkflowState[] {
    const committed = this.committedWorkflowState(workflowStateName).filter(
      ({ $workflowId }) =>
        !pending.workflowStates.has(pendingKey(workflowStateName, $workflowId))
    )
    const saved = [...pending.workflowStates.values()]
      .map(({ workflowState }) => workflowState)
      .filter(({ $name }) => $name === workflowStateName)
    return [...committed, ...saved]
  }

  /**
   * Finds the workflow state that a message maps to, and returns copies of it
   */
  private findWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowState: WorkflowState[],
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted: boolean | undefined
  ): WorkflowStateType[] {
    const filterValue = messageMap.lookup(message, attributes)
    if (!hasLookupValue(filterValue)) {
      return []
    }
    return (workflowState as WorkflowStateType[])
      .filter(
        data =>
          (includeCompleted || data.$status === WorkflowStatus.Running) &&
          (data[messageMap.mapsTo] as {} as string) === filterValue
      )
      .map(copyWorkflowState)
  }

  /**
   * Saves workflow state in a transaction, with the same version check as `saveWorkflowState`
   * @throws WorkflowStateVersionConflict if the state was saved elsewhere, or earlier in the transaction, since it was
   * read
   */
  private saveInTransaction(
    pending: PendingChanges,
    workflowState: WorkflowState
  ): void {
    const key = pendingKey(workflowState.$name, workflowState.$workflowId)
    const saved = pending.workflowStates.get(key)
    const committedVersion = saved
      ? saved.committedVersion
      : this.committedWorkflowState(workflowState.$name).find(
          ({ $workflowId }) => $workflowId === workflowState.$workflowId
        )?.$version
    assertVersionMatches(
      workflowState,
      saved ? saved.workflowState.$version : committedVersion
    )
    const updatedWorkflowState = copyWorkflowState(workflowState)
    updatedWorkflowState.$version = workflowState.$version + 1
    pending.workflowStates.set(key, {
      workflowState: updatedWorkflowState,
      committedVersion
    })
  }

  /**
   * Stores outgoing messages in a transaction
   * @returns the ids of the messages already stored, or stored earlier in the transaction
   */
  private storeInTransaction(
    pending: PendingChanges,
    outgoingMessages: OutgoingMessage[]
  ): string[] {
    const duplicateIds: string[] = []
    for (const outgoingMessage of outgoingMessages) {
      const isDuplicate =
        this.outgoingMessages.has(outgoingMessage.id) ||
        pending.outgoingMessages.some(({ id }) => id === outgoingMessage.id)
      if (isDuplicate) {
        duplicateIds.push(outgoingMessage.id)
      } else {
        pending.outgoingMessages.push(copyOutgoingMessage(outgoingMessage))
      }
    }
    return duplicateIds
  }

  /**
   * Applies what a transaction changed, all at once
   * @throws WorkflowStateVersionConflict if workflow state the transaction saved has been saved elsewhere since, in
   * which case nothing is applied
   * @throws OutgoingMessageStoredConcurrently if another transaction stored an outgoing message with the same id since
   * this one stored it, in which case nothing is applied, as a database would only report the duplicate once the other
   * transaction ended
   */
  private applyPendingChanges(pending: PendingChanges): void {
    const pendingWorkflowStates = [...pending.workflowStates.values()]
    // Checked before anything is applied, so a conflict keeps none of the transaction's changes
    for (const { workflowState, committedVersion } of pendingWorkflowStates) {
      const currentVersion = this.committedWorkflowState(
        workflowState.$name
      ).find(
        ({ $workflowId }) => $workflowId === workflowState.$workflowId
      )?.$version
      if (currentVersion !== committedVersion) {
        throw new WorkflowStateVersionConflict(
          workflowState.$name,
          workflowState.$workflowId,
          committedVersion ?? 0,
          currentVersion
        )
      }
    }
    // The bus sends the messages it was told were stored, so one stored by another transaction meanwhile can't be
    // skipped silently
    const storedConcurrently = pending.outgoingMessages.find(({ id }) =>
      this.outgoingMessages.has(id)
    )
    if (storedConcurrently) {
      throw new OutgoingMessageStoredConcurrently(storedConcurrently.id)
    }
    for (const { workflowState } of pendingWorkflowStates) {
      const existingWorkflowState = this.committedWorkflowState(
        workflowState.$name
      )
      const existingIndex = existingWorkflowState.findIndex(
        ({ $workflowId }) => $workflowId === workflowState.$workflowId
      )
      if (existingIndex >= 0) {
        existingWorkflowState[existingIndex] = workflowState
      } else {
        existingWorkflowState.push(workflowState)
      }
    }
    this.storeOutgoing(pending.outgoingMessages)
  }

  /**
   * Stores outgoing messages, skipping any whose id is already stored
   * @returns the ids of the messages that were already stored
   */
  private storeOutgoing(outgoingMessages: OutgoingMessage[]): string[] {
    const duplicateIds: string[] = []
    for (const outgoingMessage of outgoingMessages) {
      if (this.outgoingMessages.has(outgoingMessage.id)) {
        duplicateIds.push(outgoingMessage.id)
        continue
      }
      this.outgoingMessages.set(outgoingMessage.id, {
        outgoingMessage: copyOutgoingMessage(outgoingMessage),
        availableAt: Math.max(
          outgoingMessage.dueAt.getTime(),
          outgoingMessage.leaseMs === undefined
            ? 0
            : Date.now() + outgoingMessage.leaseMs
        ),
        attempts: 0
      })
    }
    return duplicateIds
  }
}

/**
 * Checks the `$version` of workflow state being saved matches the version held, as durable persistence adapters do
 * to enforce optimistic concurrency
 * @param heldVersion the `$version` held, or `undefined` if none is held, in which case a new state must have
 * `$version` 0
 * @throws WorkflowStateVersionConflict if they don't match
 */
const assertVersionMatches = (
  workflowState: WorkflowState,
  heldVersion: number | undefined
): void => {
  const isVersionMatched =
    heldVersion === undefined
      ? workflowState.$version === 0
      : heldVersion === workflowState.$version
  if (!isVersionMatched) {
    throw new WorkflowStateVersionConflict(
      workflowState.$name,
      workflowState.$workflowId,
      workflowState.$version,
      heldVersion
    )
  }
}

// Copies are kept and returned so that changes made by callers can't bypass the version check
const copyWorkflowState = <TWorkflowState extends WorkflowState>(
  workflowState: TWorkflowState
): TWorkflowState =>
  Object.assign(
    Object.create(Object.getPrototypeOf(workflowState)),
    workflowState
  )

// Copies are kept and returned, like a database would, so that changes made by callers don't reach the store
const copyOutgoingMessage = (
  outgoingMessage: OutgoingMessage
): OutgoingMessage => {
  const { message, attributes, headers } = JSON.parse(
    JSON.stringify(outgoingMessage)
  ) as OutgoingMessage
  // A lease given when storing isn't returned, as a database wouldn't return it
  return {
    id: outgoingMessage.id,
    kind: outgoingMessage.kind,
    message,
    attributes,
    headers,
    dueAt: new Date(outgoingMessage.dueAt.getTime()),
    ...(outgoingMessage.destination === undefined
      ? {}
      : { destination: outgoingMessage.destination })
  }
}
