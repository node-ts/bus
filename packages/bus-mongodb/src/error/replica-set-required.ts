/**
 * Thrown by `initialize()` when a bus configured with `withOutbox()` uses a `MongodbPersistence` connected to a
 * standalone MongoDB server. MongoDB only runs multi-document transactions on a replica set or a sharded cluster, and
 * the outbox handles each message in one.
 */
export class ReplicaSetRequired extends Error {
  readonly help =
    'Run MongoDB as a replica set, or connect through mongos to a sharded cluster. A replica set of one member works, such as for local development: start mongod with --replSet rs0, run rs.initiate() once in mongosh, and add directConnection=true to the connection string if the host name the member was initiated with is not reachable from the service. MongoDB Atlas clusters are replica sets already. Otherwise, leave withOutbox() off.'

  /**
   * @param databaseName the configured database of the persistence
   */
  constructor(readonly databaseName: string) {
    super(
      `withOutbox() needs MongoDB transactions, which need a replica set, but MongodbPersistence (database ${JSON.stringify(databaseName)}) is connected to a standalone server`
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
