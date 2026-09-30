import { CoreDependencies, Logger } from '@node-ts/bus-core'
import { Collection, Db, MongoClient } from 'mongodb'
import { IMock, It, Mock, Times } from 'typemoq'
import { TestWorkflowState } from '../test'
import { MongodbConfiguration } from './mongodb-configuration'
import { MongodbPersistence } from './mongodb-persistence'

const configuration: MongodbConfiguration = {
  connection: 'mongodb://localhost:27017',
  databaseName: 'workflows'
}

describe('MongodbPersistence', () => {
  let sut: MongodbPersistence
  let client: IMock<MongoClient>
  let database: IMock<Db>
  let collection: IMock<Collection>

  beforeEach(() => {
    client = Mock.ofType<MongoClient>()
    database = Mock.ofType<Db>()
    collection = Mock.ofType<Collection>()

    // Resolve to undefined rather than a mock, which would look like a thenable
    client.setup(c => c.connect()).returns(async () => undefined as any)
    client
      .setup(c => c.db(configuration.databaseName))
      .returns(() => database.object)
    database
      .setup(d => d.listCollections(It.isAny(), It.isAny()))
      .returns(() => ({ hasNext: async () => true }) as any)
    database
      .setup(d => d.collection(It.isAny()))
      .returns(() => collection.object)
    collection
      .setup(c => c.listIndexes())
      .returns(() => ({ toArray: async () => [] }) as any)

    sut = new MongodbPersistence(configuration, client.object)
    sut.prepare({
      loggerFactory: () => Mock.ofType<Logger>().object
    } as unknown as CoreDependencies)
  })

  describe('when initializing workflows after the persistence is initialized', () => {
    beforeEach(async () => {
      await sut.initialize()
      await sut.initializeWorkflow(TestWorkflowState, [])
      await sut.initializeWorkflow(TestWorkflowState, [])
    })

    it('should connect to mongodb once', () => {
      client.verify(c => c.connect(), Times.once())
    })
  })
})
