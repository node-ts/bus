import { Logger } from '@node-ts/bus-core'
import { escapeIdentifier, Pool, PoolClient } from 'pg'
import { InvalidSchemaName } from './error'

/**
 * Stands for the role the service runs as in the grants of the runtime permissions
 */
export const RUNTIME_ROLE = '<runtime_role>'

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
 * Postgres' undefined_table error code
 */
const UNDEFINED_TABLE_ERROR_CODE = '42P01'

/**
 * Runs queries on the pool, or on a client checked out of it, such as one in a transaction
 */
export type Queryable = Pick<Pool | PoolClient, 'query'>

/**
 * Throws if the schema name can't be used as a postgres identifier
 * @throws InvalidSchemaName
 */
export const assertValidSchemaName = (schemaName: string): void => {
  if (
    typeof schemaName !== 'string' ||
    schemaName.length === 0 ||
    schemaName.includes('\0')
  ) {
    throw new InvalidSchemaName(schemaName)
  }
}

/**
 * Quotes a schema and the name of a table, index or other relation in it for use in SQL
 * @example qualifyName('workflows', 'inbox') => '"workflows"."inbox"'
 */
export const qualifyName = (schemaName: string, name: string): string =>
  `${escapeIdentifier(schemaName)}.${escapeIdentifier(name)}`

/**
 * Whether an error is postgres reporting that a table doesn't exist
 */
export const isUndefinedTableError = (error: unknown): boolean =>
  (error as { code?: unknown } | undefined)?.code === UNDEFINED_TABLE_ERROR_CODE

/**
 * Whether an error is postgres reporting that an object being created already exists
 */
export const isDuplicateObjectError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && DUPLICATE_OBJECT_ERROR_CODES.has(code)
}

/**
 * Runs a statement that creates a database object if it's missing. Checking for the object and creating it isn't
 * atomic, so when another process creates it at the same time, postgres fails with a duplicate error once that
 * process commits. The object exists by then, so the error is ignored.
 */
export const createIfMissing = async (
  postgres: Queryable,
  logger: Logger,
  sql: string
): Promise<void> => {
  try {
    await postgres.query(sql)
  } catch (error) {
    if (!isDuplicateObjectError(error)) {
      throw error
    }
    logger.debug('Object was created at the same time by another process', {
      sql
    })
  }
}
