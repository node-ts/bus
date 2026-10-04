import { CoreDependencies, Logger } from '@node-ts/bus-core'
import { Pool, PoolClient } from 'pg'
import { IMock, It, Mock, Times } from 'typemoq'
import { TestWorkflowState } from '../test'
import { InvalidSchemaName } from './error'
import { PostgresPersistence } from './postgres-persistence'

const coreDependencies = {
  loggerFactory: () => Mock.ofType<Logger>().object
} as unknown as CoreDependencies

describe('PostgresPersistence', () => {
  let sut: PostgresPersistence
  let pool: IMock<Pool>

  describe('when initializing', () => {
    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: 'Bus-Workflows' },
        pool.object
      )
      sut.prepare(coreDependencies)
      await sut.initialize()
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

  describe('when initializing with an empty schema name', () => {
    let error: unknown

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresPersistence(
        { connection: {}, schemaName: '' },
        pool.object
      )
      sut.prepare(coreDependencies)
      error = await sut.initialize().catch(e => e)
    })

    it('should throw InvalidSchemaName', () => {
      expect(error).toBeInstanceOf(InvalidSchemaName)
    })

    it('should not query postgres', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
    })
  })

  describe('when initializing a workflow that another process creates at the same time', () => {
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
        .initializeWorkflow(TestWorkflowState, [])
        .catch((e: unknown) => e)
    })

    it('should treat the duplicate object as created', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when initializing a workflow fails for another reason', () => {
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
        .initializeWorkflow(TestWorkflowState, [])
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
