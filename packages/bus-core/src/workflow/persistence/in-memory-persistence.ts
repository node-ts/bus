import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { Logger } from '../../logger'
import { OutgoingMessage } from '../../outgoing-message'
import { ClassConstructor, CoreDependencies } from '../../util'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import {
  WorkflowStateNotInitialized,
  WorkflowStateVersionConflict
} from './error'
import { Persistence } from './persistence'

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
 * A non-durable in-memory persistence for storage and retrieval of workflow state, and of messages sent with
 * `deliverAfter` or `deliverAt`. Before using this, be warned that neither survives a process restart or
 * application shut down. As such this should only be used for testing, prototyping or handling unimportant
 * workflows.
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

  async initializeWorkflow<TWorkflowState extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    _: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const name = new workflowStateConstructor().$name
    this.workflowState[name] = []
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
    const filterValue = messageMap.lookup(message, attributes)
    if (!filterValue) {
      return []
    }

    const workflowStateName = new workflowStateConstructor().$name
    const workflowState = this.workflowState[
      workflowStateName
    ] as WorkflowStateType[]
    if (!workflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }
    return workflowState
      .filter(
        data =>
          (includeCompleted || data.$status === WorkflowStatus.Running) &&
          (data[messageMap.mapsTo] as {} as string) === filterValue
      )
      .map(copyWorkflowState)
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
    const workflowStateName = workflowState.$name
    const existingWorkflowState = this.workflowState[workflowStateName]
    if (!existingWorkflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }

    const existingIndex = existingWorkflowState.findIndex(
      d => d.$workflowId === workflowState.$workflowId
    )
    const existingVersion =
      existingIndex >= 0
        ? existingWorkflowState[existingIndex].$version
        : undefined
    const isVersionMatched =
      existingVersion === undefined
        ? workflowState.$version === 0
        : existingVersion === workflowState.$version
    if (!isVersionMatched) {
      throw new WorkflowStateVersionConflict(
        workflowStateName,
        workflowState.$workflowId,
        workflowState.$version,
        existingVersion
      )
    }

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
          outgoingMessage.leaseUntil?.getTime() ?? 0
        ),
        attempts: 0
      })
    }
    return duplicateIds
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

  async releaseOutgoingMessages(ids: string[]): Promise<void> {
    for (const id of ids) {
      const stored = this.outgoingMessages.get(id)
      if (stored) {
        stored.availableAt = stored.outgoingMessage.dueAt.getTime()
        stored.attempts = Math.max(stored.attempts - 1, 0)
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
    dueAt: new Date(outgoingMessage.dueAt.getTime())
  }
}
