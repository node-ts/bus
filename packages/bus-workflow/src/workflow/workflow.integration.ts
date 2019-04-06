import { Container } from 'inversify'
import { BusModule, Bus, BUS_SYMBOLS, ApplicationBootstrap } from '@node-ts/bus-core'
import { Persistence } from './persistence'
import { BUS_WORKFLOW_SYMBOLS } from '../bus-workflow-symbols'
import { TestCommand, TestWorkflowData, TestWorkflow, TaskRan } from '../test'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { sleep } from '../utility'
import { WorkflowStatus } from './workflow-data'
import { WorkflowRegistry } from './registry/workflow-registry'
import { BusWorkflowModule } from '../bus-workflow-module'
import { LoggerModule } from '@node-ts/logger-core'

describe('Workflow', () => {
  let container: Container
  let persistence: Persistence
  let bootstrap: ApplicationBootstrap

  beforeAll(async () => {
    container = new Container()
    container.load(new LoggerModule())
    container.load(new BusModule())
    container.load(new BusWorkflowModule())

    persistence = container.get<Persistence>(BUS_WORKFLOW_SYMBOLS.Persistence)

    const workflowRegistry = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflowRegistry.register(TestWorkflow, TestWorkflowData)
    await workflowRegistry.initializeWorkflows()

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)
  })

  afterAll(async () => {
    await bootstrap.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    let bus: Bus

    const command = new TestCommand('abc')
    const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
      cmd => cmd.property1,
      'property1'
    )
    let workflowData: TestWorkflowData[]
    const CONSUME_TIMEOUT = 500

    beforeAll(async () => {
      bus = container.get(BUS_SYMBOLS.Bus)
      await bus.send(command)
      await sleep(CONSUME_TIMEOUT)
      workflowData = await persistence.getWorkflowData<TestWorkflowData, TestCommand>(
        TestWorkflowData,
        propertyMapping,
        command
      )
    })

    it('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(1)
      expect(data).toMatchObject({ property1: command.property1 })
    })

    describe('and then a message for the next step is received', () => {
      const event = new TaskRan('abc')
      let finalWorkflowData: TestWorkflowData[]

      beforeAll(async () => {
        await bus.publish(event)
        await sleep(CONSUME_TIMEOUT)

        finalWorkflowData = await persistence.getWorkflowData<TestWorkflowData, TestCommand>(
          TestWorkflowData,
          propertyMapping,
          command,
          true
        )
      })

      it('should handle that message', () => {
        expect(finalWorkflowData).toHaveLength(1)
        const data = finalWorkflowData[0]
        expect(data.$version).toEqual(2)
      })
    })
  })

})
