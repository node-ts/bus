import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  WorkflowState
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { Pool, PoolClient } from 'pg'
import { PostgresConfiguration } from './postgres-configuration'
import { WorkflowStateNotFound } from './error'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

export class PostgresPersistence implements Persistence {

  private coreDependencies: CoreDependencies
  private logger: Logger
  private client: PoolClient | undefined

  constructor (
    private readonly configuration: PostgresConfiguration,
    private readonly postgres: Pool = new Pool(configuration.connection)
  ) {
  }

  prepare (coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory('@node-ts/bus-persistence:postgres-persistence')
  }

  async initialize (): Promise<void> {
    this.logger.info('Initializing postgres persistence...')
    this.client = await this.postgres.connect()
    await this.ensureSchemaExists(this.configuration.schemaName)
    this.logger.info('Postgres persistence initialized')
  }

  async dispose (): Promise<void> {
    this.logger.info('Disposing postgres persistence...')
    if (this.client) {
      this.client.release()
      this.client = undefined
    }
    await this.postgres.end()
    this.logger.info('Postgres persistence disposed')
  }

  async initializeWorkflow<WorkflowStateType extends WorkflowState> (
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const workflowStateName = new workflowStateConstructor().$name
    this.logger.info('Initializing workflow', { workflowState: workflowStateName })

    const tableName = resolveQualifiedTableName(workflowStateName, this.configuration.schemaName)
    await this.ensureTableExists(tableName)
    await this.ensureIndexesExist(tableName, messageWorkflowMappings)
  }

  async getWorkflowState<WorkflowStateType extends WorkflowState, MessageType extends Message> (
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted = false
  ): Promise<WorkflowStateType[]> {
    this.logger.debug('Getting workflow state', { workflowStateName: workflowStateConstructor.name })
    const workflowStateName = new workflowStateConstructor().$name
    const tableName = resolveQualifiedTableName(workflowStateName, this.configuration.schemaName)
    const matcherValue = messageMap.lookup(message, attributes)

    const workflowStateField = `${WORKFLOW_DATA_FIELD_NAME}->>'${messageMap.mapsTo}'`
    const query = `
      select
        ${WORKFLOW_DATA_FIELD_NAME}
      from
        ${tableName}
      where
        (${includeCompleted} = true or ${WORKFLOW_DATA_FIELD_NAME}->>'$status' = 'running')
        and (${workflowStateField}) is not null
        and (${workflowStateField}::text) = $1
    `
    this.logger.debug('Querying workflow state', { query })

    const results = await this.postgres.query(
      query,
      [matcherValue]
    )

    this.logger.debug('Got workflow state', { resultsCount: results.rows.length })

    const rows = results.rows as [{ [WORKFLOW_DATA_FIELD_NAME]: WorkflowStateType | undefined }]

    return rows
      .map(row => row[WORKFLOW_DATA_FIELD_NAME])
      .filter(workflowState => workflowState !== undefined)
      .map(workflowState => this.coreDependencies.serializer.toClass(workflowState!, workflowStateConstructor))
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState> (
    workflowState: WorkflowStateType
  ): Promise<void> {
    this.logger.debug(
      'Saving workflow state',
      { workflowStateName: workflowState.$name, id: workflowState.$workflowId }
    )
    const tableName = resolveQualifiedTableName(workflowState.$name, this.configuration.schemaName)

    const oldVersion = workflowState.$version
    const newVersion = oldVersion + 1
    const plainWorkflowState = {
      ...this.coreDependencies.serializer.toPlain(workflowState),
      $version: newVersion
    }

    await this.upsertWorkflowState(
      tableName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
    )
  }

  private async ensureSchemaExists (schema: string): Promise<void> {
    const sql = `create schema if not exists ${schema};`
    this.logger.debug('Ensuring workflow schema exists', { sql })
    await this.postgres.query(sql)
  }

  private async ensureTableExists (tableName: string): Promise<void> {
    const sql = `
      create table if not exists ${tableName} (
        id uuid not null primary key,
        version integer not null,
        ${WORKFLOW_DATA_FIELD_NAME} jsonb not null
      );
    `
    this.logger.debug('Ensuring postgres table for workflow state exists', { sql })
    await this.postgres.query(sql)
  }

  private async ensureIndexesExist (
    tableName: string,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const createPrimaryIndex = this.createPrimaryIndex(tableName)

    const allWorkflowFields = messageWorkflowMappings.map(mapping => mapping.mapsTo)
    const distinctWorkflowFields = new Set(allWorkflowFields)
    const workflowFields: string[] = [...distinctWorkflowFields]

    const createSecondaryIndexes = workflowFields.map(async workflowField => {
      const indexName = resolveIndexName(tableName, workflowField)
      const indexNameWithSchema = `${this.configuration.schemaName}.${indexName}`
      const workflowStateField = `${WORKFLOW_DATA_FIELD_NAME}->>'${workflowField}'`
      // Support Postgres 9.4+
      const createSecondaryIndex = `
        DO
        $$
        BEGIN
          IF to_regclass('${indexNameWithSchema}') IS NULL THEN
            CREATE INDEX
              ${indexName}
            ON
              ${tableName} ((${workflowStateField}))
            WHERE
              (${workflowStateField}) is not null;
          END IF;
        END
        $$;
      `
      this.logger.debug('Ensuring secondary index exists', { createSecondaryIndex })
      await this.postgres.query(createSecondaryIndex)
    })

    await Promise.all([createPrimaryIndex, ...createSecondaryIndexes])
  }

  private async createPrimaryIndex (tableName: string): Promise<void> {
    const primaryIndexName = resolveIndexName(tableName, 'id', 'version')
    const primaryIndexNameWithSchema = `${this.configuration.schemaName}.${primaryIndexName}`
    // Support Postgres 9.4+
    const createPrimaryIndexSql = `
      DO
      $$
      BEGIN
        IF to_regclass('${primaryIndexNameWithSchema}') IS NULL THEN
          CREATE INDEX ${primaryIndexName} ON ${tableName} (id, version);
        END IF;
      END
      $$;
    `
    this.logger.debug('Ensuring primary index exists', { createPrimaryIndexSql })
    await this.postgres.query(createPrimaryIndexSql)
  }

  private async upsertWorkflowState (
    tableName: string,
    workflowId: string,
    plainWorkflowState: object,
    oldVersion: number,
    newVersion: number
  ): Promise<void> {
    if (oldVersion === 0) {
      this.logger.debug('Inserting new workflow state', { tableName, workflowId, oldVersion, newVersion })

      // This is a new workflow, so just insert the data
      await this.postgres.query(`
        insert into ${tableName} (
          id,
          version,
          ${WORKFLOW_DATA_FIELD_NAME}
        ) values (
          $1,
          $2,
          $3
        );`,
        [
          workflowId,
          newVersion,
          this.coreDependencies.serializer.serialize(plainWorkflowState)
        ])
    } else {
      this.logger.debug('Updating existing workflow state', { tableName, workflowId, oldVersion, newVersion })

      // This is an existing workflow, so update the data
      const result = await this.postgres.query(`
        update
          ${tableName}
        set
          version = $1,
          ${WORKFLOW_DATA_FIELD_NAME} = $2
        where
          id = $3
          and version = $4;`,
        [
          newVersion,
          this.coreDependencies.serializer.serialize(plainWorkflowState),
          workflowId,
          oldVersion
        ]
      )

      if (result.rowCount === 0) {
        throw new WorkflowStateNotFound(workflowId, tableName, oldVersion)
      }
    }
  }
}

/**
 * Returns a legal fully qualified schema + table name
 */
function resolveQualifiedTableName (tableName: string, schemaName: string): string {
  const invalidPostgresCharacters = /[^0-9a-zA-Z_.-]/g
  const normalizedTableName = tableName.replace(invalidPostgresCharacters, '').toLowerCase()
  const formattedTableName = toSnakeCase(normalizedTableName)
  return `"${schemaName}"."${formattedTableName}"`
}

/**
 * Converts pascal to snake case
 * @example MyTableName => my_table_name
 */
function toSnakeCase (value: string): string {
  return value.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`)
}

/**
 * Resolves the name of an index from the fields contained in that index
 */
function resolveIndexName (tableName: string, ...fields: string[]): string {
  const normalizedTableName = tableName.replace(/"/g, '').replace('.', '_')
  return `"${normalizedTableName}_${fields.join('_')}_idx"`
}
