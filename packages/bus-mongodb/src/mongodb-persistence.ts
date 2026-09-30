import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  WorkflowState
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { Db, Document, MongoClient, MongoServerError } from 'mongodb'
import { WorkflowStateNotFound } from './error'
import { MongodbConfiguration } from './mongodb-configuration'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

/**
 * The mongodb server error code returned when dropping an index that doesn't exist.
 */
const INDEX_NOT_FOUND_ERROR_CODE = 27

/**
 * An index that this persistence manages on a workflow state collection.
 */
interface IndexDefinition {
  name: string
  key: Record<string, 1>
}

export class MongodbPersistence implements Persistence {
  private coreDependencies: CoreDependencies
  private logger: Logger
  private database: Db
  constructor(
    private readonly configuration: MongodbConfiguration,
    private client: MongoClient = new MongoClient(configuration.connection)
  ) {}

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-persistence:mongodb-persistence'
    )
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing mongodb persistence...')
    await this.client.connect()
    this.database = this.client.db(this.configuration.databaseName)
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
    const workflowStateField = `${WORKFLOW_DATA_FIELD_NAME}.${normalizeProperty(
      messageMap.mapsTo
    )}`
    const collection = this.database.collection(tableName)
    const findObject = {
      [workflowStateField]: matcherValue
    }
    if (!includeCompleted) {
      findObject[
        `${WORKFLOW_DATA_FIELD_NAME}.${normalizeProperty('$status')}`
      ] = 'running'
    }
    const documents = await collection.find(findObject).toArray()
    this.logger.debug('Querying workflow state', { findObject })

    this.logger.debug('Got workflow state', {
      resultsCount: documents?.length
    })

    const rows = documents.map(x => x[WORKFLOW_DATA_FIELD_NAME])
    return rows
      .map(row => mapKeys(row, (key, _) => denormalizeProperty(key)))
      .filter(workflowState => workflowState !== undefined)
      .map(workflowState =>
        this.coreDependencies.serializer.toClass(
          workflowState,
          workflowStateConstructor
        )
      )
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
    const modifiedState = mapKeys(workflowState, (key, _) =>
      normalizeProperty(key)
    )

    const plainWorkflowState = {
      ...this.coreDependencies.serializer.toPlain(modifiedState),
      __version: newVersion
    }

    await this.upsertWorkflowState(
      collectionName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
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
   * Ensures the indexes this persistence relies on exist with the right keys.
   * Indexes it doesn't manage, such as ones added by users, are left alone. A
   * managed index whose key is out of date (as created by earlier versions of
   * this package) is rebuilt.
   */
  private async ensureIndexesExist(
    collectionName: string,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName)
    const existingIndexes = (await collection.listIndexes().toArray()) ?? []

    const distinctWorkflowFields = new Set(
      messageWorkflowMappings.map(mapping => mapping.mapsTo)
    )
    const requiredIndexes: IndexDefinition[] = [
      {
        name: resolveIndexName(collectionName, 'id', 'version'),
        key: { id: 1, version: 1 }
      },
      ...[...distinctWorkflowFields].map(workflowField => ({
        name: resolveIndexName(collectionName, workflowField),
        key: {
          [`${WORKFLOW_DATA_FIELD_NAME}.${normalizeProperty(workflowField)}`]: 1
        } as Record<string, 1>
      }))
    ]

    // One at a time, so that an outdated index is dropped before it's recreated
    for (const requiredIndex of requiredIndexes) {
      await this.ensureIndexExists(
        collectionName,
        requiredIndex,
        existingIndexes
      )
    }
  }

  private async ensureIndexExists(
    collectionName: string,
    { name, key }: IndexDefinition,
    existingIndexes: Document[]
  ): Promise<void> {
    const collection = this.database.collection(collectionName)
    const existingIndex = existingIndexes.find(index => index.name === name)
    if (existingIndex) {
      if (isSameIndexKey(existingIndex.key, key)) {
        this.logger.debug('Index already exists', { indexName: name })
        return
      }
      this.logger.info('Rebuilding index with an outdated key', {
        indexName: name,
        existingKey: existingIndex.key,
        key
      })
      try {
        await collection.dropIndex(name)
      } catch (error) {
        // Another instance starting at the same time may have dropped it first
        if ((error as MongoServerError).code !== INDEX_NOT_FOUND_ERROR_CODE) {
          throw error
        }
      }
    }
    this.logger.debug('Ensuring index exists', { indexName: name, key })
    await collection.createIndex(key, { name })
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
function mapKeys(obj: any, fn: (key: string, value: any) => string) {
  return Object.keys(obj).reduce(
    (acc, oldKey) => {
      const newKey = fn(oldKey, obj[oldKey])
      acc[newKey] = obj[oldKey]
      return acc
    },
    {} as Record<string, unknown>
  )
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

/**
 * Checks if two index keys cover the same fields in the same order and direction
 */
function isSameIndexKey(a: Document, b: Document): boolean {
  return JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b))
}

/**
 * Escapes a leading `$` in a workflow state key, since mongodb field names can't
 * start with one (eg: `$workflowId` => `__workflowId`). The rest of the key is kept
 * as-is, so keys containing `$` or `__` elsewhere round-trip unchanged.
 */
function normalizeProperty(property: string): string {
  return property.replace(/^\$/, '__')
}

/**
 * Reverses `normalizeProperty` (eg: `__workflowId` => `$workflowId`)
 */
function denormalizeProperty(property: string): string {
  return property.replace(/^__/, '$')
}
