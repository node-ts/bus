/**
 * Provides configuration for creating and configuring a Mongodb persistence provider.
 */
export interface MongodbConfiguration {
  /**
   * The mongodb connection string to use. This can be a single server, a replica set, or a mongodb+srv connection.
   */
  connection: string

  /**
   * The database name to create workflow collections inside.
   */
  databaseName: string
}
