import {
  CoreDependencies,
  Logger,
  MessageWorkflowMapping,
  ProvisioningPlan,
  ResourcesNotProvisioned
} from '@node-ts/bus-core'
import { Pool, PoolClient } from 'pg'
import { IMock, It, Mock, Times } from 'typemoq'
import { TestWorkflowState } from '../test'
import { InvalidSchemaName } from './error'
import { PostgresPersistence } from './postgres-persistence'

const coreDependencies = {
  loggerFactory: () => Mock.ofType<Logger>().object
} as unknown as CoreDependencies

const testWorkflow = {
  workflowStateType: TestWorkflowState,
  messageWorkflowMappings: [
    {
      lookup: () => undefined,
      mapsTo: 'property1'
    } as unknown as MessageWorkflowMapping
  ]
}

describe('PostgresPersistence', () => {
  let sut: PostgresPersistence
  let pool: IMock<Pool>

  describe('when provisioning', () => {
    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'Bus-Workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      await sut.provision({ workflows: [], dryRun: false })
    })

    it('should not check out a pool client', () => {
      pool.verify(p => p.connect(), Times.never())
    })

    it('should create the schema with a quoted name', () => {
      pool.verify(
        p => p.query('create schema if not exists "Bus-Workflows";'),
        Times.once()
      )
    })
  })

  describe('when a dry run is provisioned', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      plan = await sut.provision({ workflows: [testWorkflow], dryRun: true })
    })

    it('should not query postgres', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
    })

    it('should plan the schema, tables and indexes', () => {
      expect(plan.resources.map(({ type, name }) => `${type} ${name}`)).toEqual(
        [
          'postgres-schema workflows',
          'postgres-table "workflows"."outgoing_messages"',
          'postgres-index outgoing_messages_available_at_idx',
          'postgres-table "workflows"."testworkflowstate"',
          'postgres-index workflows_testworkflowstate_id_version_idx',
          'postgres-index workflows_testworkflowstate_property1_idx'
        ]
      )
    })

    it('should return the grants it needs at runtime', () => {
      expect(plan.runtimePermissions).toEqual({
        format: 'sql',
        document: [
          'GRANT USAGE ON SCHEMA "workflows" TO <runtime_role>;',
          'GRANT SELECT, INSERT, UPDATE, DELETE ON "workflows"."outgoing_messages" TO <runtime_role>;',
          'GRANT SELECT, INSERT, UPDATE ON "workflows"."testworkflowstate" TO <runtime_role>;'
        ]
      })
    })
  })

  describe('when initializing with an empty schema name', () => {
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: '' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut
        .initialize({ workflows: [], verifyResources: true })
        .catch(e => e)
    })

    it('should throw InvalidSchemaName', () => {
      expect(error).toBeInstanceOf(InvalidSchemaName)
    })

    it('should not query postgres', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
    })
  })

  describe('when initializing and the schema does not exist', () => {
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      pool
        .setup(async p => p.query(It.isAny(), It.isAny()))
        .returns(async () => ({ rowCount: 0, rows: [] }) as any)
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut
        .initialize({ workflows: [testWorkflow], verifyResources: true })
        .catch((e: unknown) => e)
    })

    it('should throw ResourcesNotProvisioned naming the schema', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect(error).toMatchObject({
        adapterName: 'PostgresPersistence',
        missingResources: ['Postgres schema "workflows"']
      })
    })

    it('should create nothing', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
    })
  })

  describe('when initializing and a workflow table does not exist', () => {
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      pool
        .setup(async p => p.query(It.isAny(), It.isAny()))
        .returns(async (sql: string, [names]: string[][]) =>
          sql.includes('pg_namespace')
            ? ({ rowCount: 1, rows: [{}] } as any)
            : ({
                rows: names
                  .filter(name => !name.includes('testworkflowstate"'))
                  .map(name => ({ name }))
              } as any)
        )
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut
        .initialize({ workflows: [testWorkflow], verifyResources: true })
        .catch((e: unknown) => e)
    })

    it('should throw ResourcesNotProvisioned naming the table', () => {
      expect(error).toMatchObject({
        missingResources: ['Postgres table "workflows"."testworkflowstate"']
      })
    })
  })

  describe('when initializing without verifying resources', () => {
    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      await sut.initialize({
        workflows: [testWorkflow],
        verifyResources: false
      })
    })

    it('should not query postgres', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
      pool.verify(p => p.query(It.isAny(), It.isAny()), Times.never())
    })
  })

  describe('when provisioning a workflow that another process creates at the same time', () => {
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      pool
        .setup(async p => p.query(It.isAny()))
        .returns(async () =>
          Promise.reject(
            Object.assign(new Error('duplicate key value'), { code: '23505' })
          )
        )
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut
        .provision({ workflows: [testWorkflow], dryRun: false })
        .then(() => undefined)
        .catch((e: unknown) => e)
    })

    it('should treat the duplicate object as created', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when provisioning a workflow fails for another reason', () => {
    const queryError = Object.assign(new Error('permission denied'), {
      code: '42501'
    })
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      pool
        .setup(async p => p.query(It.isAny()))
        .returns(async () => Promise.reject(queryError))
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut
        .provision({ workflows: [testWorkflow], dryRun: false })
        .catch((e: unknown) => e)
    })

    it('should throw the error', () => {
      expect(error).toBe(queryError)
    })
  })

  describe('when a transaction fails to begin', () => {
    const beginError = new Error('Connection refused')
    let client: IMock<PoolClient>
    let error: unknown

    beforeAll(async () => {
      client = Mock.ofType<PoolClient>()
      // Otherwise the mock looks like a promise, and awaiting it never settles
      client
        .setup(c => (c as unknown as { then: unknown }).then)
        .returns(() => undefined)
      client
        .setup(async c => c.query('begin'))
        .returns(async () => Promise.reject(beginError))
      pool = Mock.ofType<Pool>()
      pool.setup(async p => p.connect()).returns(async () => client.object)
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut.beginTransaction().catch((e: unknown) => e)
    })

    it('should throw the error', () => {
      expect(error).toBe(beginError)
    })

    it('should destroy the client rather than return it to the pool', () => {
      client.verify(c => c.release(beginError), Times.once())
    })
  })
})
