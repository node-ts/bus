import {
  ClassConstructor,
  CoreDependencies,
  hasLookupValue,
  INBOX_RETENTION_MS,
  Logger,
  MessageWorkflowMapping,
  OutgoingMessage,
  OutgoingMessageClaim,
  PersistedWorkflow,
  Persistence,
  PersistenceInitializationOptions,
  PersistenceProvisionOptions,
  PersistenceTransaction,
  ProvisionedResource,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  WorkflowState
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import {
  AnyBulkWriteOperation,
  ClientSession,
  CreateIndexesOptions,
  Db,
  MongoClient
} from 'mongodb'
import { ReplicaSetRequired, WorkflowStateNotFound } from './error'
import { decodeKeys, encodeKey, encodeKeys } from './key-encoding'
import { MongodbConfiguration } from './mongodb-configuration'
import {
  MongodbPersistenceTransaction,
  TRANSACTION_OPTIONS
} from './mongodb-persistence-transaction'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

/**
 * The collection that stores messages sent with `deliverAfter` or `deliverAt`
 */
const OUTGOING_MESSAGES_COLLECTION_NAME = 'outgoingmessages'

/**
 * The collection that records the messages each endpoint has handled with `withOutbox()`
 */
const INBOX_COLLECTION_NAME = 'inbox'

/**
 * An index this persistence creates on a collection
 */
interface MongodbIndex {
  name: string
  keys: { [field: string]: 1 }
  options?: Pick<CreateIndexesOptions, 'unique' | 'expireAfterSeconds'>
}

/**
 * A collection this persistence stores documents in, with the indexes it creates on it
 */
interface MongodbCollection {
  name: string
  /**
   * What the collection stores
   */
  stores:
    'outgoing messages' | 'inbox records of handled messages' | 'workflow state'
  indexes: MongodbIndex[]
}

/**
 * A document of the inbox collection: a message an endpoint has handled
 */
interface InboxDocument {
  endpoint: string
  messageId: string
  /**
   * When the database recorded it. A TTL index removes it once it's older than the inbox keeps records.
   */
  processedAt: Date
}

/**
 * A document of the outgoing messages collection. The message, attributes and headers are stored with their keys
 * encoded, like workflow state.
 */
interface OutgoingMessageDocument {
  _id: string
  kind: OutgoingMessage['kind']
  /**
   * Where a reply is sent. Other messages have none.
   */
  destination?: string
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
 * Stores workflow state, and messages sent with `deliverAfter` or `deliverAt`, in MongoDB.
 *
 * It supports `withOutbox()`, which needs MongoDB to run as a replica set or a sharded cluster: each message is handled
 * in a transaction in a `ClientSession`, which handlers can write their own data in with `mongoSession(ctx)`.
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

  /**
   * Connects, and checks, unless `verifyResources` is off, that the outgoing messages and inbox collections and the
   * collection of each workflow exist with their indexes, with `listCollections` and `listIndexes`. It creates
   * nothing. When the bus is configured with `withOutbox()`, it also checks the deployment can run transactions.
   * @param options the workflows of the bus, whether to check their collections exist, and whether the bus has an
   * outbox
   * @throws ReplicaSetRequired if the bus is configured with `withOutbox()` and the server is standalone
   * @throws ResourcesNotProvisioned if a collection or an index doesn't exist
   */
  async initialize(options: PersistenceInitializationOptions): Promise<void> {
    this.logger.info('Initializing mongodb persistence...')
    await this.connect()
    if (options.outbox) {
      await this.assertTransactionsSupported()
    }
    if (options.verifyResources) {
      const missingResources = await this.findMissingResources(
        resolveCollections(options.workflows)
      )
      if (missingResources.length) {
        throw new ResourcesNotProvisioned(
          'MongodbPersistence',
          missingResources
        )
      }
    }
    this.logger.info('Mongodb persistence initialized')
  }

  /**
   * Creates the outgoing messages collection with an index on when each message is next available, the inbox
   * collection that records the messages each endpoint has handled with `withOutbox()`, with a unique index on the
   * endpoint and message id and a TTL index that removes records after the inbox's retention, and for each workflow
   * state a collection with an `{ id, version }` index and an index on each field its messages look it up by. What
   * exists is left as it is, and no index is ever dropped.
   *
   * It needs the `createCollection`, `createIndex` and `listCollections` actions on the database.
   * @param options the workflows of the bus, and whether it's a dry run
   * @returns the collections and indexes, and the privileges the persistence needs at runtime
   */
  async provision(
    options: PersistenceProvisionOptions
  ): Promise<ProvisioningPlan> {
    const { databaseName } = this.configuration
    const collections = resolveCollections(options.workflows)
    const plan: ProvisioningPlan = {
      adapter: 'MongodbPersistence',
      resources: collections.flatMap(({ name, stores, indexes }) => [
        {
          type: 'mongodb-collection',
          name: `${databaseName}.${name}`,
          properties: { stores }
        },
        ...indexes.map((index): ProvisionedResource => ({
          type: 'mongodb-index',
          name: index.name,
          properties: {
            collection: `${databaseName}.${name}`,
            keys: index.keys as { [field: string]: number },
            ...index.options
          }
        }))
      ]),
      runtimePermissions: {
        format: 'mongodb-privileges',
        document: [
          {
            resource: { db: databaseName, collection: '' },
            actions: ['listCollections']
          },
          ...collections.map(({ name, stores }) => ({
            resource: { db: databaseName, collection: name },
            actions:
              stores === 'workflow state'
                ? ['find', 'insert', 'update', 'listIndexes']
                : ['find', 'insert', 'update', 'remove', 'listIndexes']
          }))
        ]
      }
    }
    if (options.dryRun) {
      return plan
    }

    this.logger.info('Provisioning mongodb persistence', {
      resources: plan.resources.length
    })
    await this.connect()
    for (const { name, indexes } of collections) {
      await this.ensureCollectionExists(name)
      await this.ensureIndexesExist(name, indexes)
    }
    return plan
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Mongodb persistence...')
    await this.client.close()
    this.logger.info('Mongodb persistence disposed')
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
    return this.queryWorkflowState(
      undefined,
      workflowStateConstructor,
      messageMap,
      message,
      attributes,
      includeCompleted
    )
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    await this.writeWorkflowState(undefined, workflowState)
  }

  async storeOutgoingMessages(
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    return this.insertOutgoingMessages(undefined, outgoingMessages)
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
        ...(document.destination === undefined
          ? {}
          : { destination: document.destination }),
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

  async releaseOutgoingMessages(claims: OutgoingMessageClaim[]): Promise<void> {
    if (claims.length === 0) {
      return
    }
    this.logger.debug('Releasing outgoing messages', {
      numMessages: claims.length
    })
    // It was due when it was claimed, so its due time makes it claimable straight away, whatever the clock says.
    // Matching the attempts leaves a message alone if another process has claimed it since.
    await this.outgoingMessages().bulkWrite(
      claims.map(({ id, attempts }) => ({
        updateOne: {
          filter: { _id: id, attempts },
          update: [
            {
              $set: {
                availableAt: '$dueAt',
                attempts: { $max: [{ $subtract: ['$attempts', 1] }, 0] }
              }
            }
          ]
        }
      })),
      { ordered: false }
    )
  }

  /**
   * Removes up to `limit` inbox records made before a time, comparing it with when the database recorded them. The
   * inbox collection's TTL index removes records once they're older than the inbox keeps them, so this usually finds
   * none: it only catches records the TTL monitor, which runs about once a minute, hasn't removed yet.
   */
  async removeIncomingMessagesBefore(
    before: Date,
    limit: number
  ): Promise<number> {
    // One batch through the processedAt index, so each delete is short. A missing collection finds nothing.
    const ids = (
      await this.inbox()
        .find(
          { processedAt: { $lt: before } },
          { projection: { _id: 1 }, limit }
        )
        .toArray()
    ).map(({ _id }) => _id)
    if (ids.length === 0) {
      return 0
    }
    const { deletedCount } = await this.inbox().deleteMany({
      _id: { $in: ids },
      processedAt: { $lt: before }
    })
    this.logger.debug('Removed old inbox records', {
      numRecords: deletedCount
    })
    return deletedCount
  }

  /**
   * Starts a session of the client and a transaction in it, which reads one snapshot and is committed with majority
   * write concern. Handlers use the session with `mongoSession(ctx)`. MongoDB only runs transactions on a replica set
   * or a sharded cluster, which `initialize()` checks when the bus is configured with `withOutbox()`.
   * @returns the transaction
   */
  async beginTransaction(): Promise<PersistenceTransaction> {
    const session = this.client.startSession()
    // Nothing is sent to the server until the first operation in the transaction
    session.startTransaction(TRANSACTION_OPTIONS)
    this.logger.debug('Began transaction')
    return new MongodbPersistenceTransaction(session, this.logger, {
      getWorkflowState: async (
        workflowStateConstructor,
        messageMap,
        message,
        attributes,
        includeCompleted
      ) =>
        this.queryWorkflowState(
          session,
          workflowStateConstructor,
          messageMap,
          message,
          attributes,
          includeCompleted
        ),
      saveWorkflowState: async workflowState =>
        this.writeWorkflowState(session, workflowState),
      storeOutgoingMessages: async outgoingMessages =>
        this.insertOutgoingMessages(session, outgoingMessages),
      recordIncomingMessage: async (endpoint, messageId) =>
        this.insertIncomingMessage(session, endpoint, messageId)
    })
  }

  private async queryWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    session: ClientSession | undefined,
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
    // A query for no value would match every instance whose mapped field is missing, null or empty. Guarded here, so
    // a lookup in a transaction is guarded too.
    if (!hasLookupValue(matcherValue)) {
      return []
    }
    const collection = this.database.collection(tableName)
    const findObject = {
      [resolveWorkflowStateFieldPath(messageMap.mapsTo)]: matcherValue
    }
    if (!includeCompleted) {
      findObject[resolveWorkflowStateFieldPath('$status')] = 'running'
    }
    this.logger.debug('Querying workflow state', { findObject })
    const documents = await collection.find(findObject, { session }).toArray()

    this.logger.debug('Got workflow state', {
      resultsCount: documents?.length
    })

    const rows = documents.map(x => x[WORKFLOW_DATA_FIELD_NAME])
    // The bus restores the classes of the state with its own serializer and message types
    return rows
      .filter(row => row !== undefined)
      .map(row => decodeKeys(row) as WorkflowStateType)
  }

  private async writeWorkflowState<WorkflowStateType extends WorkflowState>(
    session: ClientSession | undefined,
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
      session,
      collectionName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
    )
  }

  /**
   * Stores outgoing messages, leaving any whose id is already stored as it is. A message is first claimable at its due
   * time, or when its lease ends, `leaseMs` after it's stored by the database's clock, if that's later.
   * @returns the ids of the messages that were already stored
   */
  private async insertOutgoingMessages(
    session: ClientSession | undefined,
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    if (outgoingMessages.length === 0) {
      return []
    }
    this.logger.debug('Storing outgoing messages', {
      numMessages: outgoingMessages.length
    })
    // A pipeline update, so a lease runs from $$NOW, the database's clock that claims compare with. It only sets a
    // document that isn't stored yet: one that is, which has attempts, is replaced with itself, which changes nothing.
    // Every stored value is a $literal, so a string that starts with $ isn't read as a field path.
    const operations: AnyBulkWriteOperation<OutgoingMessageDocument>[] =
      outgoingMessages.map(
        ({
          id,
          kind,
          destination,
          message,
          attributes,
          headers,
          dueAt,
          leaseMs
        }) => ({
          updateOne: {
            filter: { _id: id },
            update: [
              {
                $replaceWith: {
                  $cond: {
                    if: { $eq: [{ $type: '$attempts' }, 'missing'] },
                    then: {
                      $mergeObjects: [
                        {
                          $literal: {
                            _id: id,
                            kind,
                            ...(destination === undefined
                              ? {}
                              : { destination }),
                            message: encodeKeys(message),
                            attributes: encodeKeys(attributes),
                            headers: encodeKeys(headers),
                            dueAt,
                            attempts: 0
                          }
                        },
                        {
                          availableAt:
                            leaseMs === undefined
                              ? { $literal: dueAt }
                              : {
                                  $max: [
                                    { $literal: dueAt },
                                    { $add: ['$$NOW', leaseMs] }
                                  ]
                                }
                        }
                      ]
                    },
                    else: '$$ROOT'
                  }
                }
              }
            ],
            upsert: true
          }
        })
      )
    const result = await this.outgoingMessages().bulkWrite(operations, {
      ordered: false,
      session
    })
    // Only inserted messages are upserted, so the rest were already stored
    const upsertedIndexes = new Set(Object.keys(result.upsertedIds).map(Number))
    return outgoingMessages
      .filter((_, index) => !upsertedIndexes.has(index))
      .map(({ id }) => id)
  }

  /**
   * Records that an endpoint handled a message, at the database's time, unless it already has
   * @returns false if the endpoint had already handled the message
   */
  private async insertIncomingMessage(
    session: ClientSession,
    endpoint: string,
    messageId: string
  ): Promise<boolean> {
    // An upsert rather than an insert, since a duplicate key error would abort the transaction. A record that exists
    // keeps its processedAt, so the update changes nothing. One that another open transaction has inserted fails
    // with a write conflict, which the transaction waits out.
    const result = await this.inbox().updateOne(
      { endpoint, messageId },
      [{ $set: { processedAt: { $ifNull: ['$processedAt', '$$NOW'] } } }],
      { upsert: true, session }
    )
    return result.upsertedCount === 1
  }

  /**
   * Checks the deployment runs transactions: a replica set member reports the name of its set, and mongos, in front
   * of a sharded cluster, reports `isdbgrid`
   * @throws ReplicaSetRequired for a standalone server
   */
  private async assertTransactionsSupported(): Promise<void> {
    const hello = (await this.database.command({ hello: 1 })) as {
      setName?: string
      msg?: string
    }
    if (hello.setName === undefined && hello.msg !== 'isdbgrid') {
      throw new ReplicaSetRequired(this.configuration.databaseName)
    }
  }

  private inbox() {
    return this.database.collection<InboxDocument>(INBOX_COLLECTION_NAME)
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

  /**
   * Connects the client, which is a no-op once it's connected
   */
  private async connect(): Promise<void> {
    await this.client.connect()
    this.database = this.client.db(this.configuration.databaseName)
  }

  /**
   * Finds the collections and indexes that don't exist
   * @returns a description of each one that's missing
   */
  private async findMissingResources(
    collections: MongodbCollection[]
  ): Promise<string[]> {
    const { databaseName } = this.configuration
    const existingCollections = new Set(
      (
        await this.database.listCollections({}, { nameOnly: true }).toArray()
      ).map(({ name }) => name)
    )
    const missing: string[] = []
    for (const { name, indexes } of collections) {
      if (!existingCollections.has(name)) {
        missing.push(`MongoDB collection ${databaseName}.${name}`)
        continue
      }
      const existingIndexes = new Set(
        (await this.database.collection(name).listIndexes().toArray()).map(
          index => index.name as string
        )
      )
      missing.push(
        ...indexes
          .filter(index => !existingIndexes.has(index.name))
          .map(
            index => `MongoDB index ${index.name} on ${databaseName}.${name}`
          )
      )
    }
    return missing
  }

  private async ensureCollectionExists(collectionName: string): Promise<void> {
    this.logger.debug('Ensuring mongodb collection exists', {
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
    indexes: MongodbCollection['indexes']
  ): Promise<void> {
    const collection = this.database.collection(collectionName)
    this.logger.debug('Ensuring indexes exist', {
      collectionName,
      indexes: indexes.map(({ name }) => name)
    })
    await Promise.all(
      indexes.map(async ({ name, keys, options }) =>
        collection.createIndex(keys, { ...options, name })
      )
    )
  }

  private async upsertWorkflowState(
    session: ClientSession | undefined,
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
      await collection.insertOne(
        {
          id: workflowId,
          version: newVersion,
          [WORKFLOW_DATA_FIELD_NAME]: plainWorkflowState
        },
        { session }
      )
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
        { includeResultMetadata: true, session }
      )
      if (!result?.value) {
        throw new WorkflowStateNotFound(workflowId, collectionName, oldVersion)
      }
    }
  }
}

/**
 * Resolves the collections the persistence stores documents in, with their indexes: one for outgoing messages, one for
 * the inbox, and one for each workflow state
 */
function resolveCollections(
  workflows: PersistedWorkflow[]
): MongodbCollection[] {
  const collections = new Map<string, MongodbCollection>()
  collections.set(OUTGOING_MESSAGES_COLLECTION_NAME, {
    name: OUTGOING_MESSAGES_COLLECTION_NAME,
    stores: 'outgoing messages',
    indexes: [
      {
        name: resolveIndexName(
          OUTGOING_MESSAGES_COLLECTION_NAME,
          'availableAt'
        ),
        keys: { availableAt: 1 }
      }
    ]
  })
  // Provisioned whether or not the bus uses withOutbox(), so turning the outbox on later needs no new resources
  collections.set(INBOX_COLLECTION_NAME, {
    name: INBOX_COLLECTION_NAME,
    stores: 'inbox records of handled messages',
    indexes: [
      {
        name: resolveIndexName(INBOX_COLLECTION_NAME, 'endpoint', 'messageId'),
        keys: { endpoint: 1, messageId: 1 },
        options: { unique: true }
      },
      {
        // MongoDB removes a record once it's older than the inbox keeps records
        name: resolveIndexName(INBOX_COLLECTION_NAME, 'processedAt'),
        keys: { processedAt: 1 },
        options: { expireAfterSeconds: INBOX_RETENTION_MS / 1000 }
      }
    ]
  })
  for (const { workflowStateType, messageWorkflowMappings } of workflows) {
    const name = resolveQualifiedTableName(new workflowStateType().$name)
    const collection: MongodbCollection = collections.get(name) ?? {
      name,
      stores: 'workflow state',
      indexes: [
        {
          name: resolveIndexName(name, 'id', 'version'),
          keys: { id: 1, version: 1 }
        }
      ]
    }
    collections.set(name, collection)
    for (const { mapsTo } of messageWorkflowMappings) {
      const indexName = resolveIndexName(name, mapsTo)
      if (!collection.indexes.some(index => index.name === indexName)) {
        collection.indexes.push({
          name: indexName,
          keys: { [resolveWorkflowStateFieldPath(mapsTo)]: 1 }
        })
      }
    }
  }
  return [...collections.values()]
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
