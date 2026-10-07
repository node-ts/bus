import { Bus, CoreDependencies, Logger } from '@node-ts/bus-core'
import { Db, MongoClient } from 'mongodb'
import { Mock } from 'typemoq'
import { ReplicaSetRequired } from './error'
import { MongodbPersistence } from './mongodb-persistence'

const configuration = {
  connection: 'mongodb://localhost:27017',
  databaseName: 'workflows'
}

/**
 * A client whose server answers `hello` as given, and has every collection and index, so only the transaction check
 * can fail
 */
const fakeClient = (hello: object): MongoClient => {
  const database = Mock.ofType<Db>()
  database.setup(async d => d.command({ hello: 1 })).returns(async () => hello)
  const client = Mock.ofType<MongoClient>()
  client.setup(async c => c.connect()).returns(async () => undefined as never)
  client
    .setup(c => c.db(configuration.databaseName))
    .returns(() => database.object)
  return client.object
}

const initialize = async (hello: object, outbox: boolean): Promise<unknown> => {
  const sut = new MongodbPersistence(configuration, fakeClient(hello))
  sut.prepare({
    loggerFactory: () => Mock.ofType<Logger>().object
  } as unknown as CoreDependencies)
  return sut
    .initialize({ workflows: [], verifyResources: false, outbox })
    .catch((e: unknown) => e)
}

describe('MongodbPersistence', () => {
  describe('when a bus is configured with withOutbox()', () => {
    let error: unknown

    beforeAll(() => {
      // The client only connects at initialize(), so building a bus doesn't need a database
      const sut = new MongodbPersistence(configuration)
      try {
        Bus.configure()
          .withLogger(() => Mock.ofType<Logger>().object)
          .withPersistence(sut)
          .withOutbox()
          .build()
      } catch (e) {
        error = e
      }
    })

    it('should build', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when initialized for an outbox on a standalone server', () => {
    let error: unknown

    beforeAll(async () => {
      error = await initialize({ isWritablePrimary: true }, true)
    })

    it('should throw ReplicaSetRequired, saying how to run a replica set', () => {
      expect(error).toBeInstanceOf(ReplicaSetRequired)
      expect(error).toMatchObject({
        databaseName: 'workflows',
        help: expect.stringContaining('--replSet') as string
      })
    })
  })

  describe('when initialized for an outbox on a replica set', () => {
    let error: unknown

    beforeAll(async () => {
      error = await initialize(
        { isWritablePrimary: true, setName: 'rs0' },
        true
      )
    })

    it('should initialize', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when initialized for an outbox through mongos', () => {
    let error: unknown

    beforeAll(async () => {
      error = await initialize(
        { isWritablePrimary: true, msg: 'isdbgrid' },
        true
      )
    })

    it('should initialize', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when initialized without an outbox on a standalone server', () => {
    let error: unknown

    beforeAll(async () => {
      error = await initialize({ isWritablePrimary: true }, false)
    })

    it('should initialize', () => {
      expect(error).toBeUndefined()
    })
  })
})
