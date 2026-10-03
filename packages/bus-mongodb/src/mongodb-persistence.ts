import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  OutgoingMessage,
  Persistence,
  WorkflowState
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { AnyBulkWriteOperation, Db, MongoClient } from 'mongodb'
import { WorkflowStateNotFound } from './error'
import { decodeKeys, encodeKey, encodeKeys } from './key-encoding'
import { MongodbConfiguration } from './mongodb-configuration'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

/**
 * The collection that stores messages sent with `deliverAfter` or `deliverAt`
 */
const OUTGOING_MESSAGES_COLLECTION_NAME = 'outgoingmessages'

/**
 * A document of the outgoing messages collection. The message, attributes and headers are stored with their keys
 * encoded, like workflow state.
 */
interface OutgoingMessageDocument {
  _id: string
  kind: OutgoingMessage['kind']
  message: object
  attributes: object
  headers: object
  dueAt: Date
  /**
   * When the message can next be claimed: its due time, or the end of its lease once it's been claimed. Claims
   * only read this field, so leased messages don't slow them down as they pile up.
   */
  availableAt: Date
  attempts: number
}

/**
 * Stores workflow state, and messages sent with `deliverAfter` or `deliverAt`, in MongoDB
 */
export class MongodbPersistence implements Persistence {
  /**
   * What it stores is kept in MongoDB, so it survives a restart
   */
  readonly durable = true
  private logger: Logger
  private database: Db
  constructor(
    private readonly configuration: MongodbConfiguration,
    private client: MongoClient = new MongoClient(configuration.connection)
  ) {}

  prepare(coreDependencies: CoreDependencies): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-persistence:mongodb-persistence'
    )
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing mongodb persistence...')
    await this.client.connect()
    this.database = this.client.db(this.configuration.databaseName)
    await this.outgoingMessages().createIndex(
      { availableAt: 1 },
      {
        name: resolveIndexName(OUTGOING_MESSAGES_COLLECTION_NAME, 'availableAt')
      }
    )
    this.logger.info('Mongodb persistence initialized')
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Mongodb persistence...')
    await this.client.close()
    this.logger.info('Mongodb persistence disposed')
  }

  async initializeWorkflow<WorkflowStateType extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    await this.client.connect()
    this.database = this.client.db(this.configuration.databaseName)
    const workflowStateName = new workflowStateConstructor().$name
    this.logger.info('Initializing workflow', {
      workflowState: workflowStateName
    })

    const collectionName = resolveQualifiedTableName(workflowStateName)
    await this.ensureCollectionExists(collectionName)
    await this.ensureIndexesExist(collectionName, messageWorkflowMappings)
  }

  async getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted = false
  ): Promise<WorkflowStateType[]> {
    this.logger.debug('Getting workflow state', {
      workflowStateName: workflowStateConstructor.name
    })
    const workflowStateName = new workflowStateConstructor().$name
    const tableName = resolveQualifiedTableName(workflowStateName)
    const matcherValue = messageMap.lookup(message, attributes)
    const collection = this.database.collection(tableName)
    const findObject = {
      [resolveWorkflowStateFieldPath(messageMap.mapsTo)]: matcherValue
    }
    if (!includeCompleted) {
      findObject[resolveWorkflowStateFieldPath('$status')] = 'running'
    }
    const documents = await collection.find(findObject).toArray()
    this.logger.debug('Querying workflow state', { findObject })

    this.logger.debug('Got workflow state', {
      resultsCount: documents?.length
    })

    const rows = documents.map(x => x[WORKFLOW_DATA_FIELD_NAME])
    // The bus restores the classes of the state with its own serializer and message types
    return rows
      .filter(row => row !== undefined)
      .map(row => decodeKeys(row) as WorkflowStateType)
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    this.logger.debug('Saving workflow state', {
      workflowStateName: workflowState.$name,
      id: workflowState.$workflowId
    })
    const collectionName = resolveQualifiedTableName(workflowState.$name)

    const oldVersion = workflowState.$version
    const newVersion = oldVersion + 1

    const plainWorkflowState = encodeKeys({
      ...workflowState,
      $version: newVersion
    })

    await this.upsertWorkflowState(
      collectionName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
    )
  }

  async storeOutgoingMessages(
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    if (outgoingMessages.length === 0) {
      return []
    }
    this.logger.debug('Storing outgoing messages', {
      numMessages: outgoingMessages.length
    })
    // An upsert that only sets fields on insert leaves a message that's already stored as it is
    const operations: AnyBulkWriteOperation<OutgoingMessageDocument>[] =
      outgoingMessages.map(
        ({ id, kind, message, attributes, headers, dueAt, leaseUntil }) => ({
          updateOne: {
            filter: { _id: id },
            update: {
              $setOnInsert: {
                kind,
                message: encodeKeys(message),
                attributes: encodeKeys(attributes),
                headers: encodeKeys(headers),
                dueAt,
                availableAt: new Date(
                  Math.max(dueAt.getTime(), leaseUntil?.getTime() ?? 0)
                ),
                attempts: 0
              }
            },
            upsert: true
          }
        })
      )
    const result = await this.outgoingMessages().bulkWrite(operations, {
      ordered: false
    })
    // Only inserted messages are upserted, so the rest were already stored
    const upsertedIndexes = new Set(Object.keys(result.upsertedIds).map(Number))
    return outgoingMessages
      .filter((_, index) => !upsertedIndexes.has(index))
      .map(({ id }) => id)
  }

  /**
   * Claims due messages, comparing times with the database's clock unless `now` is given
   */
  async claimDueOutgoingMessages(
    limit: number,
    leaseMs: number,
    maxLeaseMs: number,
    now?: Date
  ): Promise<OutgoingMessage[]> {
    const claimAt = now ?? (await this.databaseTime())
    const claimed: OutgoingMessage[] = []
    // Each findOneAndUpdate claims one message atomically, so concurrent claims never return the same one
    while (claimed.length < limit) {
      const result = await this.outgoingMessages().findOneAndUpdate(
        { availableAt: { $lte: claimAt } },
        // A pipeline update, so the lease can grow with the attempts it has just counted
        [
          { $set: { attempts: { $add: ['$attempts', 1] } } },
          {
            $set: {
              availableAt: {
                $add: [
                  claimAt,
                  { $min: [{ $multiply: ['$attempts', leaseMs] }, maxLeaseMs] }
                ]
              }
            }
          }
        ],
        {
          sort: { availableAt: 1 },
          returnDocument: 'after',
          includeResultMetadata: true
        }
      )
      const document = result?.value
      if (!document) {
        break
      }
      claimed.push({
        id: document._id,
        kind: document.kind,
        message: decodeKeys(document.message),
        attributes: decodeKeys(
          document.attributes
        ) as OutgoingMessage['attributes'],
        headers: decodeKeys(document.headers) as OutgoingMessage['headers'],
        dueAt: document.dueAt,
        attempts: document.attempts
      })
    }
    if (claimed.length > 0) {
      this.logger.debug('Claimed due outgoing messages', {
        numMessages: claimed.length
      })
    }
    return claimed.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
  }

  async deleteOutgoingMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    this.logger.debug('Deleting outgoing messages', { numMessages: ids.length })
    await this.outgoingMessages().deleteMany({ _id: { $in: ids } })
  }

  /**
   * Reads the database server's clock, so every process claims by the same time
   */
  private async databaseTime(): Promise<Date> {
    const { localTime } = (await this.database.command({ hello: 1 })) as {
      localTime: Date
    }
    return localTime
  }

  private outgoingMessages() {
    return this.database.collection<OutgoingMessageDocument>(
      OUTGOING_MESSAGES_COLLECTION_NAME
    )
  }

  private async ensureCollectionExists(collectionName: string): Promise<void> {
    this.logger.debug('Ensuring mongodb collection for workflow state exists', {
      collectionName
    })
    const collectionExists = await this.database
      .listCollections({ name: collectionName }, { nameOnly: true })
      .hasNext()
    if (!collectionExists) {
      await this.database.createCollection(collectionName)
    }
  }

  /**
   * Creates the indexes this persistence relies on. Creating an index that already
   * exists is a no-op, and no other index is ever dropped, so indexes added by users
   * are left alone.
   */
  private async ensureIndexesExist(
    collectionName: string,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName)
    const distinctWorkflowFields = new Set(
      messageWorkflowMappings.map(mapping => mapping.mapsTo)
    )

    this.logger.debug('Ensuring indexes exist', {
      collectionName,
      workflowFields: [...distinctWorkflowFields]
    })
    await Promise.all([
      collection.createIndex(
        { id: 1, version: 1 },
        { name: resolveIndexName(collectionName, 'id', 'version') }
      ),
      ...[...distinctWorkflowFields].map(workflowField =>
        collection.createIndex(
          { [resolveWorkflowStateFieldPath(workflowField)]: 1 },
          { name: resolveIndexName(collectionName, workflowField) }
        )
      )
    ])
  }

  private async upsertWorkflowState(
    collectionName: string,
    workflowId: string,
    plainWorkflowState: object,
    oldVersion: number,
    newVersion: number
  ): Promise<void> {
    const collection = this.database.collection(collectionName)
    if (oldVersion === 0) {
      this.logger.debug('Inserting new workflow state', {
        collectionName,
        workflowId,
        oldVersion,
        newVersion
      })
      // This is a new workflow, so just insert the data
      await collection.insertOne({
        id: workflowId,
        version: newVersion,
        [WORKFLOW_DATA_FIELD_NAME]: plainWorkflowState
      })
    } else {
      this.logger.debug('Updating existing workflow state', {
        collectionName,
        workflowId,
        oldVersion,
        newVersion
      })
      const result = await collection.findOneAndUpdate(
        {
          id: workflowId,
          version: oldVersion
        },
        {
          $set: {
            version: newVersion,
            [WORKFLOW_DATA_FIELD_NAME]: plainWorkflowState
          }
        },
        // mongodb 6+ returns the bare document by default while 5.x returns the
        // metadata wrapper. Ask for the wrapper so the check below behaves the
        // same whichever driver a user-supplied MongoClient comes from.
        { includeResultMetadata: true }
      )
      if (!result?.value) {
        throw new WorkflowStateNotFound(workflowId, collectionName, oldVersion)
      }
    }
  }
}

/**
 * Resolves the stored path of a workflow state property, as used by both queries
 * and indexes
 * @example resolveWorkflowStateFieldPath('$workflowId') => 'data.%24workflowId'
 */
function resolveWorkflowStateFieldPath(property: string): string {
  return `${WORKFLOW_DATA_FIELD_NAME}.${encodeKey(property)}`
}

/**
 * Returns a legal fully qualified schema + table name
 */
function resolveQualifiedTableName(collectionName: string): string {
  const invalidPostgresCharacters = /[^0-9a-zA-Z_.-]/g
  const normalizedTableName = collectionName
    .replace(invalidPostgresCharacters, '')
    .toLowerCase()
  const formattedTableName = toSnakeCase(normalizedTableName)
  return `${formattedTableName}`
}

/**
 * Converts pascal to snake case
 * @example MyTableName => my_table_name
 */
function toSnakeCase(value: string): string {
  return value.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`)
}

/**
 * Resolves the name of an index from the fields contained in that index
 */
function resolveIndexName(tableName: string, ...fields: string[]): string {
  const normalizedTableName = tableName.replace(/"/g, '').replace('.', '_')
  return `"${normalizedTableName}_${fields.join('_')}_idx"`
}
