import {
  ClassConstructor,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  WorkflowState
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { escapeIdentifier, escapeLiteral, Pool } from 'pg'
import { InvalidSchemaName, WorkflowStateNotFound } from './error'
import { PostgresConfiguration } from './postgres-configuration'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

/**
 * The schema and table that store one type of workflow state
 */
interface WorkflowTable {
  /**
   * The unquoted schema name
   */
  schemaName: string
  /**
   * The unquoted table name
   */
  tableName: string
  /**
   * The quoted, schema-qualified table name for use in SQL
   */
  qualifiedName: string
}

export class PostgresPersistence implements Persistence {
  private logger: Logger

  constructor(
    private readonly configuration: PostgresConfiguration,
    private readonly postgres: Pool = new Pool(configuration.connection)
  ) {}

  prepare(coreDependencies: CoreDependencies): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-persistence:postgres-persistence'
    )
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing postgres persistence...')
    assertValidSchemaName(this.configuration.schemaName)
    await this.ensureSchemaExists(this.configuration.schemaName)
    this.logger.info('Postgres persistence initialized')
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing postgres persistence...')
    await this.postgres.end()
    this.logger.info('Postgres persistence disposed')
  }

  async initializeWorkflow<WorkflowStateType extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const workflowStateName = new workflowStateConstructor().$name
    this.logger.info('Initializing workflow', {
      workflowState: workflowStateName
    })

    const table = resolveWorkflowTable(
      workflowStateName,
      this.configuration.schemaName
    )
    await this.ensureTableExists(table)
    await this.ensureIndexesExist(table, messageWorkflowMappings)
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
    const { qualifiedName } = resolveWorkflowTable(
      workflowStateName,
      this.configuration.schemaName
    )
    const matcherValue = messageMap.lookup(message, attributes)

    // The field is inlined as a literal rather than bound so the expression matches the secondary index
    const workflowStateField = resolveWorkflowStateField(messageMap.mapsTo)
    const statusFilter = includeCompleted
      ? ''
      : `and ${WORKFLOW_DATA_FIELD_NAME}->>'$status' = 'running'`
    const query = `
      select
        ${WORKFLOW_DATA_FIELD_NAME}
      from
        ${qualifiedName}
      where
        (${workflowStateField}) is not null
        and (${workflowStateField}::text) = $1
        ${statusFilter}
    `
    this.logger.debug('Querying workflow state', { query })

    const results = await this.postgres.query(query, [matcherValue])

    this.logger.debug('Got workflow state', {
      resultsCount: results.rows.length
    })

    const rows = results.rows as [
      { [WORKFLOW_DATA_FIELD_NAME]: WorkflowStateType | undefined }
    ]

    // The bus restores the classes of the state with its own serializer and message types
    return rows
      .map(row => row[WORKFLOW_DATA_FIELD_NAME])
      .filter(workflowState => workflowState !== undefined)
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    this.logger.debug('Saving workflow state', {
      workflowStateName: workflowState.$name,
      id: workflowState.$workflowId
    })
    const { qualifiedName } = resolveWorkflowTable(
      workflowState.$name,
      this.configuration.schemaName
    )

    const oldVersion = workflowState.$version
    const newVersion = oldVersion + 1
    const plainWorkflowState = {
      ...workflowState,
      $version: newVersion
    }

    await this.upsertWorkflowState(
      qualifiedName,
      workflowState.$workflowId,
      plainWorkflowState,
      oldVersion,
      newVersion
    )
  }

  private async ensureSchemaExists(schema: string): Promise<void> {
    const sql = `create schema if not exists ${escapeIdentifier(schema)};`
    this.logger.debug('Ensuring workflow schema exists', { sql })
    await this.postgres.query(sql)
  }

  private async ensureTableExists(table: WorkflowTable): Promise<void> {
    const sql = `
      create table if not exists ${table.qualifiedName} (
        id uuid not null primary key,
        version integer not null,
        ${WORKFLOW_DATA_FIELD_NAME} jsonb not null
      );
    `
    this.logger.debug('Ensuring postgres table for workflow state exists', {
      sql
    })
    await this.postgres.query(sql)
  }

  private async ensureIndexesExist(
    table: WorkflowTable,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const createPrimaryIndex = this.createPrimaryIndex(table)

    const allWorkflowFields = messageWorkflowMappings.map(
      mapping => mapping.mapsTo
    )
    const distinctWorkflowFields = new Set(allWorkflowFields)
    const workflowFields: string[] = [...distinctWorkflowFields]

    const createSecondaryIndexes = workflowFields.map(async workflowField => {
      const indexName = resolveIndexName(table, workflowField)
      const workflowStateField = resolveWorkflowStateField(workflowField)
      // Support Postgres 9.4+
      const createSecondaryIndex = `
        DO
        $$
        BEGIN
          IF to_regclass(${resolveQualifiedIndexLiteral(table, indexName)}) IS NULL THEN
            CREATE INDEX
              ${escapeIdentifier(indexName)}
            ON
              ${table.qualifiedName} ((${workflowStateField}))
            WHERE
              (${workflowStateField}) is not null;
          END IF;
        END
        $$;
      `
      this.logger.debug('Ensuring secondary index exists', {
        createSecondaryIndex
      })
      await this.postgres.query(createSecondaryIndex)
    })

    await Promise.all([createPrimaryIndex, ...createSecondaryIndexes])
  }

  private async createPrimaryIndex(table: WorkflowTable): Promise<void> {
    const primaryIndexName = resolveIndexName(table, 'id', 'version')
    // Support Postgres 9.4+
    const createPrimaryIndexSql = `
      DO
      $$
      BEGIN
        IF to_regclass(${resolveQualifiedIndexLiteral(table, primaryIndexName)}) IS NULL THEN
          CREATE INDEX ${escapeIdentifier(primaryIndexName)} ON ${table.qualifiedName} (id, version);
        END IF;
      END
      $$;
    `
    this.logger.debug('Ensuring primary index exists', {
      createPrimaryIndexSql
    })
    await this.postgres.query(createPrimaryIndexSql)
  }

  private async upsertWorkflowState(
    tableName: string,
    workflowId: string,
    plainWorkflowState: object,
    oldVersion: number,
    newVersion: number
  ): Promise<void> {
    if (oldVersion === 0) {
      this.logger.debug('Inserting new workflow state', {
        tableName,
        workflowId,
        oldVersion,
        newVersion
      })

      // This is a new workflow, so just insert the data
      await this.postgres.query(
        `
        insert into ${tableName} (
          id,
          version,
          ${WORKFLOW_DATA_FIELD_NAME}
        ) values (
          $1,
          $2,
          $3
        );`,
        [workflowId, newVersion, JSON.stringify(plainWorkflowState)]
      )
    } else {
      this.logger.debug('Updating existing workflow state', {
        tableName,
        workflowId,
        oldVersion,
        newVersion
      })

      // This is an existing workflow, so update the data
      const result = await this.postgres.query(
        `
        update
          ${tableName}
        set
          version = $1,
          ${WORKFLOW_DATA_FIELD_NAME} = $2
        where
          id = $3
          and version = $4;`,
        [newVersion, JSON.stringify(plainWorkflowState), workflowId, oldVersion]
      )

      if (result.rowCount === 0) {
        throw new WorkflowStateNotFound(workflowId, tableName, oldVersion)
      }
    }
  }
}

/**
 * Throws if the schema name can't be used as a postgres identifier
 * @throws InvalidSchemaName
 */
const assertValidSchemaName = (schemaName: string): void => {
  if (
    typeof schemaName !== 'string' ||
    schemaName.length === 0 ||
    schemaName.includes('\0')
  ) {
    throw new InvalidSchemaName(schemaName)
  }
}

/**
 * Resolves the schema and legal table name that store a type of workflow state
 */
const resolveWorkflowTable = (
  workflowStateName: string,
  schemaName: string
): WorkflowTable => {
  const invalidPostgresCharacters = /[^0-9a-zA-Z_.-]/g
  const normalizedTableName = workflowStateName
    .replace(invalidPostgresCharacters, '')
    .toLowerCase()
  const tableName = toSnakeCase(normalizedTableName)
  return {
    schemaName,
    tableName,
    qualifiedName: `${escapeIdentifier(schemaName)}.${escapeIdentifier(tableName)}`
  }
}

/**
 * Converts pascal to snake case
 * @example MyTableName => my_table_name
 */
const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`)

/**
 * Resolves the unquoted name of an index from the fields contained in that index
 */
const resolveIndexName = (table: WorkflowTable, ...fields: string[]): string =>
  `${table.schemaName}_${table.tableName}_${fields.join('_')}_idx`

/**
 * Resolves a SQL string literal of the schema-qualified index name, as accepted by `to_regclass`
 */
const resolveQualifiedIndexLiteral = (
  table: WorkflowTable,
  indexName: string
): string =>
  escapeLiteral(
    `${escapeIdentifier(table.schemaName)}.${escapeIdentifier(indexName)}`
  )

/**
 * Resolves the SQL expression that reads a workflow state field as text
 */
const resolveWorkflowStateField = (field: string): string =>
  `${WORKFLOW_DATA_FIELD_NAME}->>${escapeLiteral(field)}`
