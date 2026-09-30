import { CoreDependencies, Logger } from '@node-ts/bus-core'
import { Pool } from 'pg'
import { IMock, It, Mock, Times } from 'typemoq'
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
})
