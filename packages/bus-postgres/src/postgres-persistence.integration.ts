import {
  Bus,
  BusInstance,
  Logger,
  MessageWorkflowMapping,
  WorkflowStatus
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { workflowStateRoundTripTests } from '@node-ts/bus-test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { Mock } from 'typemoq'
import {
  messageTypes,
  TestCommand,
  TestWorkflow,
  TestWorkflowState
} from '../test'
import { PostgresConfiguration } from './postgres-configuration'
import { PostgresPersistence } from './postgres-persistence'

const configuration: PostgresConfiguration = {
  connection: {
    connectionString:
      process.env.POSTGRES_URL ||
      'postgres://postgres:password@localhost:6432/postgres'
  },
  schemaName: 'workflows'
}

const roundTripSchemaName = 'workflows_round_trip'

describe('PostgresPersistence', () => {
  let sut: PostgresPersistence
  let postgres: Pool
  let bus: BusInstance

  beforeAll(async () => {
    postgres = new Pool(configuration.connection)
    await postgres.query(
      'create schema if not exists ' + configuration.schemaName
    )
    sut = new PostgresPersistence(configuration, postgres)
    bus = Bus.configure()
      .withMessageTypes(messageTypes)
      .withLogger(() => Mock.ofType<Logger>().object)
      .withPersistence(sut)
      .withWorkflow(TestWorkflow)
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => {
    await postgres.query('drop table if exists "workflows"."testworkflowstate"')
    await postgres.query('drop schema if exists ' + configuration.schemaName)
    await postgres.query(`drop schema if exists ${roundTripSchemaName} cascade`)
    await bus.dispose()
  })

  describe('when initializing the transport', () => {
    it('should create a workflow table', async () => {
      const result = await postgres.query(
        'select count(*) from "workflows"."testworkflowstate"'
      )
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('0')
    })
  })

  describe('when saving new workflow state', () => {
    const workflowState = new TestWorkflowState()
    workflowState.$workflowId = randomUUID()
    workflowState.$status = WorkflowStatus.Running
    workflowState.$version = 0
    workflowState.eventValue = 'abc'
    workflowState.property1 = 'something'

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState)
    })

    it('should add the row into the table', async () => {
      const result = await postgres.query(
        'select count(*) from "workflows"."testworkflowstate"'
      )
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('1')
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
    })
  })

  describe('when initialized', () => {
    it('should not hold a pool client', () => {
      expect(postgres.totalCount).toEqual(postgres.idleCount)
    })
  })

  describe('with a schema name that needs quoting', () => {
    const schemaName = 'Bus-Workflows'
    let quotedPool: Pool
    let quotedSut: PostgresPersistence
    let quotedBus: BusInstance
    let schemas: string[]
    let results: TestWorkflowState[]

    const workflowState = new TestWorkflowState()
    workflowState.$workflowId = randomUUID()
    workflowState.$status = WorkflowStatus.Running
    workflowState.$version = 0
    workflowState.property1 = randomUUID()

    const mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }

    beforeAll(async () => {
      quotedPool = new Pool(configuration.connection)
      quotedSut = new PostgresPersistence(
        { ...configuration, schemaName },
        quotedPool
      )
      quotedBus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withPersistence(quotedSut)
        .withWorkflow(TestWorkflow)
        .build()
      await quotedBus.initialize()

      // A second startup must be a no-op, including the index checks
      await quotedSut.initialize()
      await quotedSut.initializeWorkflow(TestWorkflowState, [
        mapping as unknown as MessageWorkflowMapping
      ])

      const schemaResult = await quotedPool.query(
        'select schema_name from information_schema.schemata where schema_name = $1',
        [schemaName]
      )
      schemas = schemaResult.rows.map(
        (row: { schema_name: string }) => row.schema_name
      )

      await quotedSut.saveWorkflowState(workflowState)
      results = await quotedSut.getWorkflowState(
        TestWorkflowState,
        mapping,
        new TestCommand(workflowState.property1),
        { attributes: {}, stickyAttributes: {} }
      )
    })

    afterAll(async () => {
      await quotedPool.query(`drop schema if exists "${schemaName}" cascade`)
      await quotedBus.dispose()
    })

    it('should create the schema with its exact name', () => {
      expect(schemas).toEqual([schemaName])
    })

    it('should save and retrieve workflow state', () => {
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ ...workflowState, $version: 1 })
    })
  })

  describe('with a mapped property name that contains quotes', () => {
    const schemaName = 'workflows_quoted_property'
    const mapsTo = `it's "quoted"`
    let quotedPool: Pool
    let quotedSut: PostgresPersistence
    let quotedBus: BusInstance
    let indexCount: number
    let results: TestWorkflowState[]

    const workflowState = new TestWorkflowState()
    workflowState.$workflowId = randomUUID()
    workflowState.$status = WorkflowStatus.Running
    workflowState.$version = 0
    const lookupValue = randomUUID()
    ;(workflowState as unknown as Record<string, string>)[mapsTo] = lookupValue

    const mapping = {
      lookup: () => lookupValue,
      mapsTo
    } as unknown as MessageWorkflowMapping<TestCommand, TestWorkflowState>

    beforeAll(async () => {
      quotedPool = new Pool(configuration.connection)
      quotedSut = new PostgresPersistence(
        { ...configuration, schemaName },
        quotedPool
      )
      quotedBus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withPersistence(quotedSut)
        .withWorkflow(TestWorkflow)
        .build()
      await quotedBus.initialize()

      const mappings = [mapping] as unknown as MessageWorkflowMapping[]
      await quotedSut.initializeWorkflow(TestWorkflowState, mappings)
      await quotedSut.initializeWorkflow(TestWorkflowState, mappings)

      const indexResult = await quotedPool.query(
        'select count(*) from pg_indexes where schemaname = $1 and indexname = $2',
        [schemaName, `${schemaName}_testworkflowstate_${mapsTo}_idx`]
      )
      indexCount = Number((indexResult.rows[0] as { count: string }).count)

      await quotedSut.saveWorkflowState(workflowState)
      results = await quotedSut.getWorkflowState(
        TestWorkflowState,
        mapping,
        new TestCommand(undefined),
        { attributes: {}, stickyAttributes: {} }
      )
    })

    afterAll(async () => {
      await quotedPool.query(`drop schema if exists "${schemaName}" cascade`)
      await quotedBus.dispose()
    })

    it('should create an index on the property', () => {
      expect(indexCount).toEqual(1)
    })

    it('should retrieve workflow state by the property', () => {
      expect(results).toHaveLength(1)
      expect(results[0].$workflowId).toEqual(workflowState.$workflowId)
    })
  })

  workflowStateRoundTripTests(
    new PostgresPersistence({
      ...configuration,
      schemaName: roundTripSchemaName
    })
  )
})
