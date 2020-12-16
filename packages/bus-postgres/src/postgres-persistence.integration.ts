import { Bus, WorkflowStatus, MessageWorkflowMapping, Logger } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { PostgresPersistence } from './postgres-persistence'
import { PostgresConfiguration } from './postgres-configuration'
import { Mock } from 'typemoq'
import { TestWorkflowData, TestCommand, testWorkflow } from '../test'
import { Pool } from 'pg'
import * as uuid from 'uuid'

const configuration: PostgresConfiguration = {
  connection: {
    connectionString: 'postgres://postgres:password@localhost:6432/postgres'
  },
  schemaName: 'workflows'
}

describe('PostgresPersistence', () => {
  let sut: PostgresPersistence
  let postgres: Pool

  beforeAll(async () => {
    postgres = new Pool(configuration.connection)
    await postgres.connect()
    await postgres.query('create schema if not exists ' + configuration.schemaName)

    sut = PostgresPersistence.configure(configuration)
    await Bus
      .configure()
      .withLogger(Mock.ofType<Logger>().object)
      .withPersistence(sut)
      .withWorkflow(testWorkflow)
      .initialize()

    await Bus.start()
  })

  afterAll(async () => {
    await Bus.dispose()
    await postgres.query('drop table if exists "workflows"."testworkflowdata"')
    await postgres.query('drop schema if exists ' + configuration.schemaName)
  })

  describe('when initializing the transport', () => {
    it('should create a workflow table', async () => {
      const result = await postgres.query('select count(*) from "workflows"."testworkflowdata"')
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('0')
    })
  })

  describe('when saving new workflow data', () => {
    const workflowData = new TestWorkflowData()
    workflowData.$workflowId = uuid.v4()
    workflowData.$status = WorkflowStatus.Running
    workflowData.$version = 0
    workflowData.eventValue = 'abc'
    workflowData.property1 = 'something'

    beforeAll(async () => {
      await sut.saveWorkflowData(workflowData)
    })

    it('should add the row into the table', async () => {
      const result = await postgres.query('select count(*) from "workflows"."testworkflowdata"')
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('1')
    })

    describe('when getting the workflow data by property', () => {
      const testCommand = new TestCommand(workflowData.property1)
      const messageOptions = new MessageAttributes()
      let dataV1: TestWorkflowData
      let mapping: MessageWorkflowMapping<TestCommand, TestWorkflowData>

      it('should retrieve the item', async () => {
        mapping = {
          lookupMessage: cmd => cmd.property1,
          workflowDataProperty: 'property1'
        }
        const results = await sut.getWorkflowData(
          TestWorkflowData,
          mapping,
          testCommand,
          messageOptions
        )
        expect(results).toHaveLength(1)
        dataV1 = results[0]
        expect(dataV1).toMatchObject({ ...workflowData, $version: 1 })
      })

      describe('when updating the workflow data', () => {
        let updates: TestWorkflowData
        let dataV2: TestWorkflowData

        beforeAll(async () => {
          updates = {
            ...dataV1,
            eventValue: 'something else'
          }
          await sut.saveWorkflowData(updates)

          const results = await sut.getWorkflowData(
            TestWorkflowData,
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
})
