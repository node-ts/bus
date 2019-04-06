import { PoolConfig } from 'pg'

/**
 * Provides configuration for creating and configuring a postgres pool
 */
export interface PostgresConfiguration {
  /**
   * Connection pool settings for the application to connect to the postgres instance
   */
  connection: PoolConfig

  /**
   * The schema name to create workflow tables under. This can be the 'public' default from postgres,
   * but it's recommended to use 'workflows' or something similar to group all workflow concerns in
   * the one place. This schema will be created if it doesn't already exist.
   */
  schemaName: string
}
