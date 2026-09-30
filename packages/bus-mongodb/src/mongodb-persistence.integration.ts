import {
  Bus,
  BusInstance,
  Logger,
  MessageWorkflowMapping,
  WorkflowStatus
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { Collection, Db, Document, MongoClient } from 'mongodb'
import { Mock } from 'typemoq'
import * as uuid from 'uuid'
import { TestCommand, TestWorkflow, TestWorkflowState } from '../test'
import { WorkflowStateNotFound } from './error'
import { MongodbConfiguration } from './mongodb-configuration'
import { MongodbPersistence } from './mongodb-persistence'

const configuration: MongodbConfiguration = {
  connection: process.env.MONGODB_URL || 'mongodb://localhost:27017/workflows',
  databaseName: 'workflows'
}

const PRIMARY_INDEX_NAME = '"testworkflowstate_id_version_idx"'
const PROPERTY1_INDEX_NAME = '"testworkflowstate_property1_idx"'
const WORKFLOW_ID_INDEX_NAME = '"testworkflowstate_$workflowId_idx"'

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys)
  }
  if (value === null || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...collectKeys(child)
  ])
}

/**
 * Collects the names of the indexes in the winning plan of an explain result
 */
const collectIndexNames = (explain: Document): string[] => {
  const names: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
    } else if (node !== null && typeof node === 'object') {
      Object.entries(node).forEach(([key, child]) =>
        key === 'indexName' ? names.push(child as string) : visit(child)
      )
    }
  }
  visit(explain.queryPlanner.winningPlan)
  return names
}

describe('MongodbPersistence', () => {
  let sut: MongodbPersistence
  let client: MongoClient
  let database: Db
  let collection: Collection
  let bus: BusInstance

  beforeAll(async () => {
    client = new MongoClient(configuration.connection)
    client = await client.connect()
    database = client.db(configuration.databaseName) as Db
    collection = database.collection('testworkflowstate') as Collection
    sut = new MongodbPersistence(configuration)
    bus = Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withPersistence(sut)
      .withWorkflow(TestWorkflow)
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => {
    await client.db(configuration.databaseName).dropDatabase()
    await bus.dispose()
    await client.close()
  })

  describe('when initializing the persistence', () => {
    let indexes: Document[]

    beforeAll(async () => {
      indexes = await collection.listIndexes().toArray()
    })

    it('should create a workflow table', async () => {
      const count = await collection.countDocuments()
      expect(count).toEqual(0)
    })

    it('should index the id and version fields', () => {
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: PRIMARY_INDEX_NAME,
          key: { id: 1, version: 1 }
        })
      )
    })

    it('should index the mapped property at its stored path', () => {
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: PROPERTY1_INDEX_NAME,
          key: { 'data.property1': 1 }
        })
      )
    })
  })

  describe('when querying by the fields that lookups filter on', () => {
    let primaryLookupIndexes: string[]
    let propertyLookupIndexes: string[]

    beforeAll(async () => {
      primaryLookupIndexes = collectIndexNames(
        await collection.find({ id: 'abc', version: 1 }).explain()
      )
      propertyLookupIndexes = collectIndexNames(
        await collection.find({ 'data.property1': 'abc' }).explain()
      )
    })

    it('should use the primary index for id and version lookups', () => {
      expect(primaryLookupIndexes).toContain(PRIMARY_INDEX_NAME)
    })

    it('should use the mapped property index for property lookups', () => {
      expect(propertyLookupIndexes).toContain(PROPERTY1_INDEX_NAME)
    })
  })

  describe('when initializing a workflow again', () => {
    const userIndexName = 'user_event_value_idx'
    let indexes: Document[]

    beforeAll(async () => {
      await collection.createIndex(
        { 'data.eventValue': 1 },
        { name: userIndexName }
      )

      const mappings: MessageWorkflowMapping<TestCommand, TestWorkflowState>[] =
        [
          { lookup: message => message.property1, mapsTo: 'property1' },
          { lookup: () => undefined, mapsTo: '$workflowId' }
        ]
      await sut.initializeWorkflow(
        TestWorkflowState,
        mappings as unknown as MessageWorkflowMapping[]
      )
      indexes = await collection.listIndexes().toArray()
    })

    it('should keep indexes it does not manage', () => {
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: userIndexName,
          key: { 'data.eventValue': 1 }
        })
      )
    })

    it('should index a $-prefixed mapped property at its encoded path', () => {
      expect(indexes).toContainEqual(
        expect.objectContaining({
          name: WORKFLOW_ID_INDEX_NAME,
          key: { 'data.%24workflowId': 1 }
        })
      )
    })
  })

  describe('when saving new workflow state', () => {
    const workflowState = new TestWorkflowState()
    workflowState.$workflowId = uuid.v4()
    workflowState.$status = WorkflowStatus.Running
    workflowState.$version = 0
    workflowState.eventValue = 'abc'
    workflowState.property1 = 'something'

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState)
    })

    it('should add the row into the table', async () => {
      const result = await collection.find().toArray()
      expect(result.length).toEqual(1)
      expect(result[0]).toMatchObject({
        id: workflowState.$workflowId,
        version: 1,
        data: {
          '%24workflowId': workflowState.$workflowId,
          '%24status': WorkflowStatus.Running,
          '%24version': 1,
          '%24name': 'TestWorkflowState',
          eventValue: 'abc',
          property1: 'something'
        }
      })
    })

    describe('when getting the workflow state by property', () => {
      const testCommand = new TestCommand(workflowState.property1)
      const messageOptions: MessageAttributes = {
        attributes: {},
        stickyAttributes: {}
      }
      let dataV1: TestWorkflowState
      let mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState>

      it('should retrieve the item', async () => {
        mapping = {
          lookup: message => message.property1,
          mapsTo: 'property1'
        }
        const results = await sut.getWorkflowState(
          TestWorkflowState,
          mapping,
          testCommand,
          messageOptions
        )
        expect(results).toHaveLength(1)
        dataV1 = results[0]
        expect(dataV1).toMatchObject({ ...workflowState, $version: 1 })
      })

      describe('when updating the workflow state', () => {
        let updates: TestWorkflowState
        let dataV2: TestWorkflowState

        beforeAll(async () => {
          updates = {
            ...dataV1,
            eventValue: 'something else'
          }
          await sut.saveWorkflowState(updates)

          const results = await sut.getWorkflowState(
            TestWorkflowState,
            mapping,
            testCommand,
            messageOptions
          )
          dataV2 = results[0]
        })

        it('should return the updates', () => {
          expect(dataV2).toMatchObject({
            ...updates,
            $version: 2
          })
        })
      })
      describe('when updating the workflow state with invalid version', () => {
        let updates: TestWorkflowState
        let error: Error

        beforeAll(async () => {
          updates = {
            ...dataV1,
            eventValue: 'something else'
          }
          try {
            await sut.saveWorkflowState(updates)
          } catch (err) {
            error = err as Error
          }
        })

        it('should throw WorkflowStateNotFound', async () => {
          expect(error).toBeInstanceOf(WorkflowStateNotFound)
        })
      })
    })
  })

  describe('when saving workflow state with keys that repeat $ or __', () => {
    const workflowState = Object.assign(new TestWorkflowState(), {
      $workflowId: uuid.v4(),
      $status: WorkflowStatus.Running,
      $version: 0,
      property1: uuid.v4(),
      $repeated$dollars: 'a',
      repeated__under__scores: 'b'
    })
    let result: Record<string, unknown>

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState)
      const results = await sut.getWorkflowState(
        TestWorkflowState,
        { lookup: () => workflowState.property1, mapsTo: 'property1' },
        new TestCommand(workflowState.property1),
        { attributes: {}, stickyAttributes: {} }
      )
      result = { ...results[0] }
    })

    it('should read a key with repeated $ back unchanged', () => {
      expect(result.$repeated$dollars).toEqual('a')
    })

    it('should read a key with repeated __ back unchanged', () => {
      expect(result.repeated__under__scores).toEqual('b')
    })
  })

  describe('when saving workflow state with keys mongodb cannot store as-is', () => {
    const trickyKeys = {
      $a: 1,
      a$b: 2,
      'a.b': 3,
      '%24': 4,
      a__b: 5,
      '%': 6,
      $$: 7
    }
    const workflowState = Object.assign(new TestWorkflowState(), {
      $workflowId: uuid.v4(),
      $status: WorkflowStatus.Running,
      $version: 0,
      property1: uuid.v4(),
      ...trickyKeys,
      nested: { ...trickyKeys, $deeper: [{ ...trickyKeys }] }
    })
    let storedKeys: string[]
    let results: TestWorkflowState[]

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState)
      const document = await collection.findOne({
        id: workflowState.$workflowId
      })
      storedKeys = collectKeys(document!.data)
      results = await sut.getWorkflowState(
        TestWorkflowState,
        {
          lookup: () => workflowState.$workflowId,
          mapsTo: '$workflowId'
        },
        new TestCommand(workflowState.property1),
        { attributes: {}, stickyAttributes: {} }
      )
    })

    it('should store every key without $ or .', () => {
      expect(storedKeys.filter(key => /[$.]/.test(key))).toEqual([])
    })

    it('should find the state by an encoded mapped property', () => {
      expect(results).toHaveLength(1)
    })

    it('should read every key back unchanged', () => {
      expect({ ...results[0] }).toEqual({ ...workflowState, $version: 1 })
    })
  })
})
