import { Bus, WorkflowStatus, MessageWorkflowMapping, Logger, BusInstance } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { PostgresPersistence } from './postgres-persistence'
import { PostgresConfiguration } from './postgres-configuration'
import { Mock } from 'typemoq'
import { TestWorkflowState, TestCommand, TestWorkflow } from '../test'
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
  let bus: BusInstance

  beforeAll(async () => {
    postgres = new Pool(configuration.connection)
    await postgres.query('create schema if not exists ' + configuration.schemaName)
    sut = new PostgresPersistence(configuration, postgres)
    bus = await Bus
      .configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withPersistence(sut)
      .withWorkflow(TestWorkflow)
      .initialize()

    await bus.start()
  })

  afterAll(async () => {
    await postgres.query('drop table if exists "workflows"."testworkflowstate"')
    await postgres.query('drop schema if exists ' + configuration.schemaName)
    await bus.dispose()
  })

  describe('when initializing the transport', () => {
    it('should create a workflow table', async () => {
      const result = await postgres.query('select count(*) from "workflows"."testworkflowstate"')
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('0')
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
      const result = await postgres.query('select count(*) from "workflows"."testworkflowstate"')
      const { count } = result.rows[0] as { count: string }
      expect(count).toEqual('1')
    })

    describe('when getting the workflow state by property', () => {
      const testCommand = new TestCommand(workflowState.property1)
      const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
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
})
