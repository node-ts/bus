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
import { createHash } from 'node:crypto'
import { escapeIdentifier, escapeLiteral, Pool, PoolClient } from 'pg'
import { InvalidSchemaName, WorkflowStateNotFound } from './error'
import { PostgresConfiguration } from './postgres-configuration'

/**
 * The name of the field that stores workflow state as JSON in the database row.
 */
const WORKFLOW_DATA_FIELD_NAME = 'data'

/**
 * The longest identifier postgres stores (`NAMEDATALEN - 1`). Longer ones are truncated.
 */
const IDENTIFIER_MAX_BYTES = 63

/**
 * How many hex characters of the full name's hash a shortened index name keeps
 */
const INDEX_NAME_HASH_LENGTH = 12

/**
 * Postgres error codes raised when two processes create the same object at once: a unique
 * violation on a system catalog, duplicate_table, duplicate_schema and duplicate_object (the
 * row type of a table)
 */
const DUPLICATE_OBJECT_ERROR_CODES = new Set([
  '23505',
  '42P07',
  '42P06',
  '42710'
])

/**
 * The table, in the configured schema, that stores messages sent with `deliverAfter` or `deliverAt`
 */
const OUTGOING_MESSAGES_TABLE_NAME = 'outgoing_messages'

/**
 * A row of the outgoing messages table, as `pg` parses it
 */
interface OutgoingMessageRow {
  id: string
  kind: OutgoingMessage['kind']
  message: object
  attributes: OutgoingMessage['attributes']
  headers: OutgoingMessage['headers']
  due_at: Date
  attempts: number
}

/**
 * Runs queries on the pool, or on a client checked out of it, such as one in a transaction
 */
type Queryable = Pick<Pool | PoolClient, 'query'>

/**
 * Stores outgoing messages in one statement, leaving any whose id is already stored as it is. A message is first
 * claimable at its due time, or at its lease if that's later.
 * @returns the ids of the messages that were already stored
 */
const insertOutgoingMessages = async (
  postgres: Queryable,
  table: string,
  outgoingMessages: OutgoingMessage[]
): Promise<string[]> => {
  if (outgoingMessages.length === 0) {
    return []
  }
  // Passed as one JSON parameter, so any number of messages is one statement
  const rows = outgoingMessages.map(
    ({ id, kind, message, attributes, headers, dueAt, leaseUntil }) => ({
      id,
      kind,
      message,
      attributes,
      headers,
      due_at: dueAt.toISOString(),
      available_at: new Date(
        Math.max(dueAt.getTime(), leaseUntil?.getTime() ?? 0)
      ).toISOString()
    })
  )
  const result = await postgres.query(
    `
    insert into ${table} (id, kind, message, attributes, headers, due_at, available_at, attempts)
    select id, kind, message, attributes, headers, due_at, available_at, 0
    from jsonb_to_recordset($1::jsonb) as stored (
      id text,
      kind text,
      message jsonb,
      attributes jsonb,
      headers jsonb,
      due_at timestamptz,
      available_at timestamptz
    )
    on conflict (id) do nothing
    returning id;`,
    [JSON.stringify(rows)]
  )
  const storedIds = new Set(
    (result.rows as { id: string }[]).map(row => row.id)
  )
  return outgoingMessages.map(({ id }) => id).filter(id => !storedIds.has(id))
}

/**
 * Claims the messages that are claimable at `now`, or at the database's clock when it isn't given, in one
 * statement. Each claim adds one to a message's attempts and leases it for `leaseMs` times its attempts, up to
 * `maxLeaseMs`.
 */
const claimOutgoingMessages = async (
  postgres: Queryable,
  table: string,
  limit: number,
  leaseMs: number,
  maxLeaseMs: number,
  now: Date | undefined
): Promise<OutgoingMessage[]> => {
  // skip locked lets several processes claim at once without waiting on, or returning, each other's rows. Leased
  // rows have a later available_at, so they don't slow the index scan down as they pile up.
  const result = await postgres.query(
    `
    with claimable as (
      select id
      from ${table}
      where available_at <= coalesce($1::timestamptz, now())
      order by available_at
      limit $2
      for update skip locked
    )
    update ${table} as outgoing
    set
      attempts = outgoing.attempts + 1,
      available_at = coalesce($1::timestamptz, now())
        + make_interval(
          secs => least($3::double precision * (outgoing.attempts + 1), $4::double precision) / 1000
        )
    from claimable
    where outgoing.id = claimable.id
    returning outgoing.id, outgoing.kind, outgoing.message, outgoing.attributes, outgoing.headers, outgoing.due_at,
      outgoing.attempts;`,
    [now ?? null, limit, leaseMs, maxLeaseMs]
  )
  return (result.rows as OutgoingMessageRow[]).map((row): OutgoingMessage => ({
    id: row.id,
    kind: row.kind,
    message: row.message,
    attributes: row.attributes,
    headers: row.headers,
    dueAt: row.due_at,
    attempts: row.attempts
  }))
}

/**
 * An index this persistence creates on a workflow table
 */
interface WorkflowIndex {
  /**
   * The fields the index is named after
   */
  nameFields: string[]
  /**
   * The SQL list of the columns or expressions in the index
   */
  keys: string
  /**
   * The SQL predicate of a partial index
   */
  predicate?: string
  /**
   * Each key as postgres deparses it, used to recognise an existing index
   */
  deparsedKeys: string[]
}

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

/**
 * Stores workflow state, and messages sent with `deliverAfter` or `deliverAt`, in Postgres. Delayed delivery needs
 * Postgres 9.5 or later.
 */
export class PostgresPersistence implements Persistence {
  /**
   * What it stores is kept in Postgres, so it survives a restart
   */
  readonly durable = true
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
    await this.ensureOutgoingMessagesTableExists()
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
    // Different workflow states can resolve to the same table, so only rows of this state match
    const query = `
      select
        ${WORKFLOW_DATA_FIELD_NAME}
      from
        ${qualifiedName}
      where
        (${workflowStateField}) is not null
        and (${workflowStateField}::text) = $1
        and ${WORKFLOW_DATA_FIELD_NAME}->>'$name' = $2
        ${statusFilter}
    `
    this.logger.debug('Querying workflow state', { query })

    const results = await this.postgres.query(query, [
      matcherValue,
      workflowStateName
    ])

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

  async storeOutgoingMessages(
    outgoingMessages: OutgoingMessage[]
  ): Promise<string[]> {
    this.logger.debug('Storing outgoing messages', {
      numMessages: outgoingMessages.length
    })
    return insertOutgoingMessages(
      this.postgres,
      this.outgoingMessagesTable(),
      outgoingMessages
    )
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
    const claimed = await claimOutgoingMessages(
      this.postgres,
      this.outgoingMessagesTable(),
      limit,
      leaseMs,
      maxLeaseMs,
      now
    )
    if (claimed.length > 0) {
      this.logger.debug('Claimed due outgoing messages', {
        numMessages: claimed.length
      })
    }
    // The update doesn't keep the order of the select
    return claimed.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
  }

  async deleteOutgoingMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    this.logger.debug('Deleting outgoing messages', { numMessages: ids.length })
    await this.postgres.query(
      `delete from ${this.outgoingMessagesTable()} where id = any($1::text[]);`,
      [ids]
    )
  }

  private outgoingMessagesTable(): string {
    return `${escapeIdentifier(this.configuration.schemaName)}.${escapeIdentifier(OUTGOING_MESSAGES_TABLE_NAME)}`
  }

  private async ensureOutgoingMessagesTableExists(): Promise<void> {
    const table = this.outgoingMessagesTable()
    const indexName = `${OUTGOING_MESSAGES_TABLE_NAME}_available_at_idx`
    const tableSql = `
      create table if not exists ${table} (
        id text not null primary key,
        kind text not null,
        message jsonb not null,
        attributes jsonb not null,
        headers jsonb not null,
        due_at timestamptz not null,
        available_at timestamptz not null,
        attempts integer not null default 0
      );
    `
    this.logger.debug('Ensuring outgoing messages table exists', {
      sql: tableSql
    })
    await this.createIfMissing(tableSql)
    const indexSql = `
      DO
      $$
      BEGIN
        IF to_regclass(${escapeLiteral(`${escapeIdentifier(this.configuration.schemaName)}.${escapeIdentifier(indexName)}`)}) IS NULL THEN
          CREATE INDEX ${escapeIdentifier(indexName)} ON ${table} (available_at);
        END IF;
      END
      $$;
    `
    this.logger.debug('Ensuring outgoing messages index exists', {
      sql: indexSql
    })
    await this.createIfMissing(indexSql)
  }

  private async ensureSchemaExists(schema: string): Promise<void> {
    const sql = `create schema if not exists ${escapeIdentifier(schema)};`
    this.logger.debug('Ensuring workflow schema exists', { sql })
    await this.createIfMissing(sql)
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
    await this.createIfMissing(sql)
  }

  private async ensureIndexesExist(
    table: WorkflowTable,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const primaryIndex: WorkflowIndex = {
      nameFields: ['id', 'version'],
      keys: 'id, version',
      deparsedKeys: ['id', 'version']
    }

    const distinctWorkflowFields = new Set(
      messageWorkflowMappings.map(mapping => mapping.mapsTo)
    )
    const secondaryIndexes = [...distinctWorkflowFields].map(
      (workflowField): WorkflowIndex => {
        const workflowStateField = resolveWorkflowStateField(workflowField)
        return {
          nameFields: [workflowField],
          keys: `(${workflowStateField})`,
          predicate: `(${workflowStateField}) is not null`,
          deparsedKeys: [deparseWorkflowStateField(workflowField)]
        }
      }
    )

    await Promise.all(
      [primaryIndex, ...secondaryIndexes].map(async index =>
        this.ensureIndexExists(table, index)
      )
    )
  }

  private async ensureIndexExists(
    table: WorkflowTable,
    index: WorkflowIndex
  ): Promise<void> {
    const indexName = resolveIndexName(table, ...index.nameFields)
    const legacyIndexName = resolveLegacyIndexName(table, ...index.nameFields)
    // Earlier versions gave every index its legacy name, which postgres truncated to 63 bytes.
    // An index with the same keys under that truncated name is reused rather than duplicated.
    const legacyIndexCheck =
      indexName === legacyIndexName
        ? ''
        : `AND NOT EXISTS (
            SELECT 1 FROM pg_index
            WHERE
              indexrelid = to_regclass(${resolveQualifiedIndexLiteral(table, legacyIndexName)})
              AND indrelid = to_regclass(${escapeLiteral(table.qualifiedName)})
              AND indisvalid
              AND indnatts = ${index.deparsedKeys.length}
              ${index.deparsedKeys
                .map(
                  (deparsedKey, i) =>
                    `AND pg_get_indexdef(indexrelid, ${i + 1}, false) = ${escapeLiteral(deparsedKey)}`
                )
                .join('\n')}
          )`
    const predicate = index.predicate ? `WHERE ${index.predicate}` : ''
    // Support Postgres 9.4+
    const sql = `
      DO
      $$
      BEGIN
        IF to_regclass(${resolveQualifiedIndexLiteral(table, indexName)}) IS NULL
          ${legacyIndexCheck}
        THEN
          CREATE INDEX ${escapeIdentifier(indexName)}
          ON ${table.qualifiedName} (${index.keys})
          ${predicate};
        END IF;
      END
      $$;
    `
    this.logger.debug('Ensuring index exists', { sql })
    await this.createIfMissing(sql)
  }

  /**
   * Runs a statement that creates a database object if it's missing. Checking for the object
   * and creating it isn't atomic, so when another process creates it at the same time, postgres
   * fails with a duplicate error once that process commits. The object exists by then, so the
   * error is ignored.
   */
  private async createIfMissing(sql: string): Promise<void> {
    try {
      await this.postgres.query(sql)
    } catch (error) {
      if (!isDuplicateObjectError(error)) {
        throw error
      }
      this.logger.debug(
        'Object was created at the same time by another process',
        {
          sql
        }
      )
    }
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
 * Resolves the name earlier versions gave an index. Postgres truncates it to
 * `IDENTIFIER_MAX_BYTES` when it's longer.
 */
const resolveLegacyIndexName = (
  table: WorkflowTable,
  ...fields: string[]
): string => `${table.schemaName}_${table.tableName}_${fields.join('_')}_idx`

/**
 * Resolves the unquoted name of an index from the fields contained in that index. A name that
 * fits in a postgres identifier is kept as it was. A longer one is truncated and ends with a hash
 * of the full name, so indexes on different fields never truncate to the same name.
 * @example resolveIndexName(table, 'id', 'version') => 'workflows_my_state_id_version_idx'
 */
const resolveIndexName = (
  table: WorkflowTable,
  ...fields: string[]
): string => {
  const legacyIndexName = resolveLegacyIndexName(table, ...fields)
  if (Buffer.byteLength(legacyIndexName) <= IDENTIFIER_MAX_BYTES) {
    return legacyIndexName
  }
  const hash = createHash('sha256')
    .update(legacyIndexName)
    .digest('hex')
    .substring(0, INDEX_NAME_HASH_LENGTH)
  const suffix = `_${hash}_idx`
  const prefix = truncateToBytes(
    legacyIndexName,
    IDENTIFIER_MAX_BYTES - Buffer.byteLength(suffix)
  )
  return `${prefix}${suffix}`
}

/**
 * Truncates a string to at most `maxBytes` bytes of UTF-8 without splitting a character
 */
const truncateToBytes = (value: string, maxBytes: number): string => {
  let result = ''
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maxBytes) {
      break
    }
    result += character
  }
  return result
}

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

/**
 * Resolves how postgres deparses an index key on a workflow state field, as returned by
 * `pg_get_indexdef(index, column, false)` with `standard_conforming_strings` on
 */
const deparseWorkflowStateField = (field: string): string =>
  `((${WORKFLOW_DATA_FIELD_NAME} ->> '${field.replace(/'/g, "''")}'::text))`

/**
 * Whether an error is postgres reporting that an object being created already exists
 */
const isDuplicateObjectError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && DUPLICATE_OBJECT_ERROR_CODES.has(code)
}
