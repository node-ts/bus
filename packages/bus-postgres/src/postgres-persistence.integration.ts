import { Bus, ApplicationBootstrap, BUS_SYMBOLS } from '@node-ts/bus-core'
import { PostgresPersistence } from './postgres-persistence'
import { TestContainer, TestWorkflow, TestWorkflowData, TestCommand } from '../test'
import { BUS_WORKFLOW_SYMBOLS, WorkflowRegistry, MessageWorkflowMapping, WorkflowStatus } from '@node-ts/bus-workflow'
import { PostgresConfiguration } from './postgres-configuration'
import { BUS_POSTGRES_SYMBOLS, BUS_POSTGRES_INTERNAL_SYMBOLS } from './bus-postgres-symbols'
import { Pool } from 'pg'
import * as uuid from 'uuid'

const configuration: PostgresConfiguration = {
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres'
  },
  schemaName: 'workflows'
}

describe('PostgresPersistence', () => {
  let bus: Bus
  let sut: PostgresPersistence
  let container: TestContainer
  let bootstrap: ApplicationBootstrap
  let postgres: Pool
  let workflows: WorkflowRegistry

  beforeAll(async () => {
    container = new TestContainer()
    container.bind(BUS_POSTGRES_SYMBOLS.PostgresConfiguration).toConstantValue(configuration)
    bus = container.get(BUS_SYMBOLS.Bus)
    sut = container.get(BUS_WORKFLOW_SYMBOLS.Persistence)
    postgres = container.get(BUS_POSTGRES_INTERNAL_SYMBOLS.PostgresPool)

    workflows = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflows.register(TestWorkflow, TestWorkflowData)
    await workflows.initializeWorkflows()

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)
  })

  afterAll(async () => {
    await postgres.query('drop table if exists "workflows"."testworkflowdata"')
    await bootstrap.dispose()
    await workflows.dispose() // TODO hook to bootstrap lifecycle
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
    workflowData.$version = 1
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
      let dataV1: TestWorkflowData
      let mapping: MessageWorkflowMapping<TestCommand, TestWorkflowData>

      it('should retrieve the item', async () => {
        mapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
          cmd => cmd.property1,
          'property1'
        )
        const results = await sut.getWorkflowData(
          TestWorkflowData,
          mapping,
          testCommand
        )
        expect(results).toHaveLength(1)
        dataV1 = results[0]
        expect(dataV1).toMatchObject({ ...workflowData, $version: 2 })
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
            testCommand
          )
          dataV2 = results[0]
        })

        it('should return the updates', () => {
          expect(dataV2).toMatchObject({
            ...updates,
            $version: 3
          })
        })
      })
    })
  })
})
