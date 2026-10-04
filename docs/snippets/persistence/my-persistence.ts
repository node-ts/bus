import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  WorkflowState,
  WorkflowStateVersionConflict,
  WorkflowStatus
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { DocumentStore } from './document-store'

export class MyPersistence implements Persistence {
  private logger: Logger

  constructor(private readonly store: DocumentStore) {}

  // Called by each bus that uses the persistence
  prepare(coreDependencies: CoreDependencies): void {
    this.logger = coreDependencies.loggerFactory('my-org:my-persistence')
  }

  async initialize(): Promise<void> {
    await this.store.connect()
  }

  async dispose(): Promise<void> {
    await this.store.close()
  }

  // Create somewhere to store each workflow state, indexed by the fields
  // its messages are looked up by
  async initializeWorkflow<TWorkflowState extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const indexedFields = [
      ...new Set(messageWorkflowMappings.map(mapping => mapping.mapsTo))
    ]
    await this.store.createCollection(
      collectionName(workflowStateConstructor),
      indexedFields
    )
  }

  async getWorkflowState<
    TWorkflowState extends WorkflowState,
    TMessage extends Message
  >(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    messageMap: MessageWorkflowMapping<TMessage, TWorkflowState>,
    message: TMessage,
    attributes: MessageAttributes,
    includeCompleted = false
  ): Promise<TWorkflowState[]> {
    const lookupValue = messageMap.lookup(message, attributes)
    // A message without a value belongs to no workflow, even one whose field is missing or empty
    if (
      lookupValue === undefined ||
      lookupValue === null ||
      lookupValue === ''
    ) {
      return []
    }
    const documents = await this.store.find(
      collectionName(workflowStateConstructor),
      {
        [`data.${messageMap.mapsTo}`]: lookupValue,
        ...(!includeCompleted && { 'data.$status': WorkflowStatus.Running })
      }
    )
    // Return the state as it was stored. The bus restores its classes.
    return documents.map(document => document.data as TWorkflowState)
  }

  async saveWorkflowState<TWorkflowState extends WorkflowState>(
    workflowState: TWorkflowState
  ): Promise<void> {
    const collection = collectionNameOf(workflowState)
    const document = {
      id: workflowState.$workflowId,
      version: workflowState.$version + 1,
      data: { ...workflowState, $version: workflowState.$version + 1 }
    }
    if (workflowState.$version === 0) {
      await this.store.insert(collection, document)
      return
    }
    // Optimistic concurrency: only save over the version that was read
    const saved = await this.store.replaceIfVersion(
      collection,
      workflowState.$version,
      document
    )
    if (!saved) {
      this.logger.debug('Workflow state was changed by another handler', {
        workflowId: workflowState.$workflowId
      })
      // Throwing returns the message to the queue, so it's retried with the latest state
      throw new WorkflowStateVersionConflict(
        workflowState.$name,
        workflowState.$workflowId,
        workflowState.$version,
        undefined
      )
    }
  }
}

const collectionNameOf = (workflowState: WorkflowState) =>
  workflowState.$name.replace(/[^a-z0-9]/gi, '_')

const collectionName = (
  workflowStateConstructor: ClassConstructor<WorkflowState>
) => collectionNameOf(new workflowStateConstructor())
