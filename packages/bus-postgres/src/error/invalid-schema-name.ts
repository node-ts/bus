/**
 * Thrown when the configured `schemaName` can't be used as a postgres identifier
 */
export class InvalidSchemaName extends Error {
  readonly help =
    'Set `schemaName` in the postgres configuration to a non-empty string without null characters'

  constructor(readonly schemaName: string) {
    super(`Invalid postgres schema name: ${JSON.stringify(schemaName)}`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
