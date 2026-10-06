import {
  Bus,
  BusInstance,
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  PersistedWorkflow,
  ResourcesNotProvisioned,
  WorkflowStatus
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import {
  inboxTests,
  outboxTests,
  scheduledMessageRoundTripTests,
  workflowStateRoundTripTests
} from '@node-ts/bus-test'
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

const scheduledRoundTripSchemaName = 'outgoing_round_trip'

const outboxSchemaName = 'outbox'

const inboxSchemaName = 'inbox_tests'

interface WorkflowIndex {
  name: string
  /**
   * The index definition from the table name on, so it doesn't depend on the index name
   */
  definition: string
}

/**
 * The definitions of the indexes on the test workflow table, other than its primary key,
 * when it's mapped by `property1` and `eventValue`
 */
const expectedIndexDefinitions = [
  `testworkflowstate USING btree (((data ->> 'eventValue'::text))) WHERE ((data ->> 'eventValue'::text) IS NOT NULL)`,
  `testworkflowstate USING btree (((data ->> 'property1'::text))) WHERE ((data ->> 'property1'::text) IS NOT NULL)`,
  'testworkflowstate USING btree (id, version)'
]

/**
 * The test workflow state, looked up by the given mappings
 */
const testWorkflow = (
  messageWorkflowMappings: MessageWorkflowMapping[]
): PersistedWorkflow => ({
  workflowStateType: TestWorkflowState,
  messageWorkflowMappings
})

/**
 * Provisions the given workflows, as a deploy would
 */
const provision = async (
  persistence: PostgresPersistence,
  ...workflows: PersistedWorkflow[]
): Promise<void> => {
  await persistence.provision({ workflows, dryRun: false })
}

const getWorkflowIndexes = async (
  pool: Pool,
  schemaName: string
): Promise<WorkflowIndex[]> => {
  const result = await pool.query(
    `select indexname, indexdef from pg_indexes
      where schemaname = $1 and tablename = 'testworkflowstate' and indexname <> 'testworkflowstate_pkey'`,
    [schemaName]
  )
  return result.rows.map((row: { indexname: string; indexdef: string }) => ({
    name: row.indexname,
    definition: row.indexdef.replace(/^.* ON .*\./, '')
  }))
}

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
      .withAutoProvision()
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => {
    await postgres.query('drop table if exists "workflows"."testworkflowstate"')
    await postgres.query('drop table if exists "workflows"."outgoing_messages"')
    await postgres.query('drop table if exists "workflows"."inbox"')
    await postgres.query('drop schema if exists ' + configuration.schemaName)
    await postgres.query(`drop schema if exists ${roundTripSchemaName} cascade`)
    await postgres.query(
      `drop schema if exists ${scheduledRoundTripSchemaName} cascade`
    )
    await postgres.query(`drop schema if exists ${outboxSchemaName} cascade`)
    await postgres.query(`drop schema if exists ${inboxSchemaName} cascade`)
    await bus.dispose()
  })

  describe('when the bus provisions at startup', () => {
    it('should create a workflow table', async () => {
      const result = await postgres.query(
        'select count(*) from "workflows"."testworkflowstate"'
      )
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('0')
    })

    it('should create an inbox table keyed by endpoint and message id', async () => {
      const result = await postgres.query(
        `select indexdef from pg_indexes where schemaname = 'workflows' and tablename = 'inbox' order by indexname`
      )
      expect(
        (result.rows as { indexdef: string }[]).map(({ indexdef }) =>
          indexdef.substring(indexdef.indexOf('inbox USING'))
        )
      ).toEqual([
        'inbox USING btree (endpoint, message_id)',
        'inbox USING btree (processed_at)'
      ])
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

  describe('when getting the state of a completed workflow', () => {
    const workflowState = Object.assign(new TestWorkflowState(), {
      $workflowId: randomUUID(),
      $status: WorkflowStatus.Complete,
      $version: 0,
      property1: randomUUID()
    })
    const mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }
    const testCommand = new TestCommand(workflowState.property1)
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    let runningOnly: TestWorkflowState[]
    let includingCompleted: TestWorkflowState[]

    beforeAll(async () => {
      await sut.saveWorkflowState(workflowState)
      runningOnly = await sut.getWorkflowState(
        TestWorkflowState,
        mapping,
        testCommand,
        messageOptions,
        false
      )
      includingCompleted = await sut.getWorkflowState(
        TestWorkflowState,
        mapping,
        testCommand,
        messageOptions,
        true
      )
    })

    it('should not find it without includeCompleted', () => {
      expect(runningOnly).toHaveLength(0)
    })

    it('should find it with includeCompleted', () => {
      expect(includingCompleted).toHaveLength(1)
      expect(includingCompleted[0]).toMatchObject({
        $workflowId: workflowState.$workflowId,
        $status: WorkflowStatus.Complete
      })
    })
  })

  describe('when a message whose lookup has no value is looked up in a transaction', () => {
    const mapping: MessageWorkflowMapping<TestCommand, TestWorkflowState> = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }
    let result: TestWorkflowState[]

    beforeAll(async () => {
      const transaction = await sut.beginTransaction()
      try {
        const workflowState = new TestWorkflowState()
        workflowState.$workflowId = randomUUID()
        workflowState.$status = WorkflowStatus.Running
        workflowState.$version = 0
        workflowState.property1 = ''
        await transaction.saveWorkflowState({ ...workflowState })
        result = await transaction.getWorkflowState(
          TestWorkflowState,
          mapping,
          new TestCommand(''),
          { attributes: {}, stickyAttributes: {} }
        )
      } finally {
        await transaction.rollback()
      }
    })

    it('should return no workflow state, even one whose mapped field is empty', () => {
      expect(result).toEqual([])
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
        .withAutoProvision()
        .build()
      await quotedBus.initialize()

      // Provisioning again must be a no-op, including the index checks, and finds everything it created
      const workflow = testWorkflow([
        mapping as unknown as MessageWorkflowMapping
      ])
      await provision(quotedSut, workflow)
      await quotedSut.initialize({
        workflows: [workflow],
        verifyResources: true
      })

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
        .withAutoProvision()
        .build()
      await quotedBus.initialize()

      const mappings = [mapping] as unknown as MessageWorkflowMapping[]
      await provision(quotedSut, testWorkflow(mappings))
      await provision(quotedSut, testWorkflow(mappings))

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

  describe('with index names longer than the postgres identifier limit', () => {
    // Long enough that every index name shares its first 63 bytes, where postgres truncates
    const schemaName = 'workflows_with_a_schema_name_long_enough_to_truncate'
    const legacyPrimaryIndexName = `${schemaName}_testworkflowstate_id_version_idx`
    const legacySecondaryIndexName = `${schemaName}_testworkflowstate_property1_idx`
    const mappings = [
      { lookup: () => undefined, mapsTo: 'property1' },
      { lookup: () => undefined, mapsTo: 'eventValue' }
    ] as unknown as MessageWorkflowMapping[]
    let longPool: Pool
    let longSut: PostgresPersistence

    const createLongSut = () => {
      const persistence = new PostgresPersistence(
        { ...configuration, schemaName },
        longPool
      )
      persistence.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object
      } as unknown as CoreDependencies)
      return persistence
    }

    beforeAll(() => {
      longPool = new Pool(configuration.connection)
      longSut = createLongSut()
    })

    afterAll(async () => {
      await longPool.query(`drop schema if exists "${schemaName}" cascade`)
      await longPool.end()
    })

    describe('when provisioning a workflow', () => {
      let indexes: WorkflowIndex[]

      beforeAll(async () => {
        await longPool.query(`drop schema if exists "${schemaName}" cascade`)
        await provision(longSut, testWorkflow(mappings))
        await provision(longSut, testWorkflow(mappings))
        indexes = await getWorkflowIndexes(longPool, schemaName)
      })

      it('should create every index once', () => {
        expect(indexes.map(index => index.definition).sort()).toEqual(
          expectedIndexDefinitions
        )
      })

      it('should give every index a name that fits the identifier limit', () => {
        for (const { name } of indexes) {
          expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
        }
      })
    })

    describe('when several processes provision the same workflow at once', () => {
      let indexes: WorkflowIndex[]

      beforeAll(async () => {
        await longPool.query(`drop schema if exists "${schemaName}" cascade`)
        const persistences = Array.from({ length: 5 }, createLongSut)
        await provision(longSut)
        await Promise.all(
          persistences.map(async p => provision(p, testWorkflow(mappings)))
        )
        indexes = await getWorkflowIndexes(longPool, schemaName)
      })

      it('should create every index once', () => {
        expect(indexes.map(index => index.definition).sort()).toEqual(
          expectedIndexDefinitions
        )
      })
    })

    describe('when an index with other keys exists under a legacy name', () => {
      let verificationError: unknown

      beforeAll(async () => {
        await longPool.query(`drop schema if exists "${schemaName}" cascade`)
        await provision(longSut)
        await longPool.query(`
          create table "${schemaName}"."testworkflowstate" (
            id uuid not null primary key,
            version integer not null,
            data jsonb not null
          );
          create index "${legacyPrimaryIndexName}"
            on "${schemaName}"."testworkflowstate" (version);
        `)
        verificationError = await longSut
          .initialize({
            workflows: [testWorkflow([])],
            verifyResources: true
          })
          .catch((e: unknown) => e)
      })

      it('should report the index missing when verifying', () => {
        expect(verificationError).toBeInstanceOf(ResourcesNotProvisioned)
        expect(
          (verificationError as ResourcesNotProvisioned).missingResources
        ).toHaveLength(1)
        expect(
          (verificationError as ResourcesNotProvisioned).missingResources[0]
        ).toMatch(/^Postgres index .*_idx"$/)
      })
    })

    describe.each([
      ['primary', legacyPrimaryIndexName, '(id, version)'],
      [
        'secondary',
        legacySecondaryIndexName,
        `((data ->> 'property1')) where (data ->> 'property1') is not null`
      ]
    ])(
      'when a %s index exists under its truncated legacy name',
      (_, legacyIndexName, legacyIndexColumns) => {
        let indexes: WorkflowIndex[]
        let verificationError: unknown

        beforeAll(async () => {
          await longPool.query(`drop schema if exists "${schemaName}" cascade`)
          await provision(longSut)
          // The table and the one index earlier versions created before the truncated names collided
          await longPool.query(`
            create table "${schemaName}"."testworkflowstate" (
              id uuid not null primary key,
              version integer not null,
              data jsonb not null
            );
            create index "${legacyIndexName}"
              on "${schemaName}"."testworkflowstate" ${legacyIndexColumns};
          `)
          await provision(longSut, testWorkflow(mappings))
          indexes = await getWorkflowIndexes(longPool, schemaName)
          verificationError = await longSut
            .initialize({
              workflows: [testWorkflow(mappings)],
              verifyResources: true
            })
            .catch((e: unknown) => e)
        })

        it('should find the legacy index when verifying', () => {
          expect(verificationError).toBeUndefined()
        })

        it('should keep the legacy index instead of creating a duplicate', () => {
          expect(indexes.map(index => index.definition).sort()).toEqual(
            expectedIndexDefinitions
          )
          expect(indexes.map(index => index.name)).toContain(
            legacyIndexName.substring(0, 63)
          )
        })
      }
    )
  })

  describe('when several processes provision the same workflow at once', () => {
    const schemaName = 'workflows_concurrent'
    let concurrentPool: Pool
    let indexes: WorkflowIndex[]

    beforeAll(async () => {
      concurrentPool = new Pool(configuration.connection)
      await concurrentPool.query(
        `drop schema if exists "${schemaName}" cascade`
      )
      const persistences = Array.from({ length: 5 }, () => {
        const persistence = new PostgresPersistence(
          { ...configuration, schemaName },
          new Pool(configuration.connection)
        )
        persistence.prepare({
          loggerFactory: () => Mock.ofType<Logger>().object
        } as unknown as CoreDependencies)
        return persistence
      })
      const mappings = [
        { lookup: () => undefined, mapsTo: 'property1' },
        { lookup: () => undefined, mapsTo: 'eventValue' }
      ] as unknown as MessageWorkflowMapping[]
      try {
        await Promise.all(
          persistences.map(async p => provision(p, testWorkflow(mappings)))
        )
      } finally {
        await Promise.all(persistences.map(async p => p.dispose()))
      }
      indexes = await getWorkflowIndexes(concurrentPool, schemaName)
    })

    afterAll(async () => {
      await concurrentPool.query(
        `drop schema if exists "${schemaName}" cascade`
      )
      await concurrentPool.end()
    })

    it('should create every index once', () => {
      expect(indexes.map(index => index.definition).sort()).toEqual(
        expectedIndexDefinitions
      )
    })
  })

  describe.each([
    [
      'longer than the identifier limit share their first 63 bytes',
      '@my-company/orders/fulfilment-workflow-state-for-the-region-of-the-continent-of-europe',
      '@my-company/orders/fulfilment-workflow-state-for-the-region-of-the-continent-of-america'
    ],
    [
      'differ only in characters that are stripped',
      '@acme/orders',
      'acme/orders'
    ]
  ])(
    'when the table names of two workflow states %s',
    (_, firstName, secondName) => {
      class FirstWorkflowState extends TestWorkflowState {
        $name = firstName
      }
      class SecondWorkflowState extends TestWorkflowState {
        $name = secondName
      }

      const schemaName = 'workflows_shared_table'
      const lookupValue = randomUUID()
      const mapping = {
        lookup: () => lookupValue,
        mapsTo: 'property1'
      } as unknown as MessageWorkflowMapping<TestCommand, TestWorkflowState>
      const messageAttributes: MessageAttributes = {
        attributes: {},
        stickyAttributes: {}
      }

      const firstState = new FirstWorkflowState()
      firstState.$workflowId = randomUUID()
      firstState.$status = WorkflowStatus.Running
      firstState.property1 = lookupValue

      let sharedPool: Pool
      let sharedSut: PostgresPersistence
      let firstResults: TestWorkflowState[]
      let secondResults: TestWorkflowState[]

      beforeAll(async () => {
        sharedPool = new Pool(configuration.connection)
        await sharedPool.query(`drop schema if exists "${schemaName}" cascade`)
        sharedSut = new PostgresPersistence(
          { ...configuration, schemaName },
          sharedPool
        )
        sharedSut.prepare({
          loggerFactory: () => Mock.ofType<Logger>().object
        } as unknown as CoreDependencies)
        const mappings = [mapping] as unknown as MessageWorkflowMapping[]
        await provision(
          sharedSut,
          {
            workflowStateType: FirstWorkflowState,
            messageWorkflowMappings: mappings
          },
          {
            workflowStateType: SecondWorkflowState,
            messageWorkflowMappings: mappings
          }
        )

        await sharedSut.saveWorkflowState({ ...firstState })
        const lookup = async (
          workflowState: typeof FirstWorkflowState | typeof SecondWorkflowState
        ) =>
          sharedSut.getWorkflowState(
            workflowState,
            mapping,
            new TestCommand(lookupValue),
            messageAttributes
          )
        firstResults = await lookup(FirstWorkflowState)
        secondResults = await lookup(SecondWorkflowState)
      })

      afterAll(async () => {
        await sharedPool.query(`drop schema if exists "${schemaName}" cascade`)
        await sharedPool.end()
      })

      it('should find the state of the workflow that saved it', () => {
        expect(firstResults).toHaveLength(1)
        expect(firstResults[0]).toMatchObject({
          $name: firstName,
          $workflowId: firstState.$workflowId
        })
      })

      it('should not find the state of the other workflow', () => {
        expect(secondResults).toEqual([])
      })
    }
  )

  describe('when initializing before provisioning', () => {
    const schemaName = 'workflows_unprovisioned'
    const workflow = testWorkflow([
      { lookup: () => undefined, mapsTo: 'property1' }
    ] as unknown as MessageWorkflowMapping[])
    let unprovisionedPool: Pool
    let missingSchemaError: unknown
    let missingTableError: unknown

    beforeAll(async () => {
      unprovisionedPool = new Pool(configuration.connection)
      await unprovisionedPool.query(
        `drop schema if exists "${schemaName}" cascade`
      )
      const unprovisionedSut = new PostgresPersistence(
        { ...configuration, schemaName },
        unprovisionedPool
      )
      unprovisionedSut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object
      } as unknown as CoreDependencies)
      const initialize = async () =>
        unprovisionedSut
          .initialize({ workflows: [workflow], verifyResources: true })
          .catch((e: unknown) => e)

      missingSchemaError = await initialize()
      // Provisioned without the workflow, so only its table and indexes are missing
      await provision(unprovisionedSut)
      missingTableError = await initialize()
    })

    afterAll(async () => {
      await unprovisionedPool.query(
        `drop schema if exists "${schemaName}" cascade`
      )
      await unprovisionedPool.end()
    })

    it('should fail naming the missing schema', () => {
      expect(missingSchemaError).toBeInstanceOf(ResourcesNotProvisioned)
      expect(missingSchemaError).toMatchObject({
        missingResources: [`Postgres schema "${schemaName}"`]
      })
    })

    it('should fail naming the missing workflow table and indexes', () => {
      expect(missingTableError).toMatchObject({
        missingResources: [
          `Postgres table "${schemaName}"."testworkflowstate"`,
          `Postgres index "${schemaName}"."${schemaName}_testworkflowstate_id_version_idx"`,
          `Postgres index "${schemaName}"."${schemaName}_testworkflowstate_property1_idx"`
        ]
      })
    })
  })

  workflowStateRoundTripTests(
    new PostgresPersistence({
      ...configuration,
      schemaName: roundTripSchemaName
    })
  )

  scheduledMessageRoundTripTests(
    new PostgresPersistence({
      ...configuration,
      schemaName: scheduledRoundTripSchemaName
    })
  )

  outboxTests(
    new PostgresPersistence({
      ...configuration,
      schemaName: outboxSchemaName
    })
  )

  inboxTests(
    new PostgresPersistence({
      ...configuration,
      schemaName: inboxSchemaName
    })
  )
})
