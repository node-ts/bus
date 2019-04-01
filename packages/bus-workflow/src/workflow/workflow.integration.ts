import { Container } from 'inversify'
import { BusModule, Bus, BUS_SYMBOLS, ApplicationBootstrap } from '@node-ts/bus-core'
import { Persistence } from './persistence'
import { WORKFLOW_SYMBOLS } from '../workflow-symbols'
import { TestCommand, TestWorkflowData, TestWorkflow } from '../test'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { sleep } from '../utility'
import { WorkflowStatus } from './workflow-data'
import { WorkflowRegistry } from './registry/workflow-registry'
import { WorkflowModule } from '../workflow-module'
import { LoggerModule } from '@node-ts/logger-core'

describe('Workflow', () => {
  let container: Container
  let persistence: Persistence

  beforeAll(async () => {
    container = new Container()
    container.load(new LoggerModule())
    container.load(new BusModule())
    container.load(new WorkflowModule())

    persistence = container.get<Persistence>(WORKFLOW_SYMBOLS.Persistence)

    const workflowRegistry = container.get<WorkflowRegistry>(WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflowRegistry.register(TestWorkflow, TestWorkflowData)
    await workflowRegistry.initializeWorkflows()

    const bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)
  })

  describe('when a message that starts a workflow is received', () => {
    let bus: Bus

    const message = new TestCommand('abc')
    const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
      command => command.property1,
      'property1'
    )
    let workflowData: TestWorkflowData[]
    const CONSUME_TIMEOUT = 100

    beforeAll(async () => {
      bus = container.get(BUS_SYMBOLS.Bus)
      await bus.send(message)
      await sleep(CONSUME_TIMEOUT)
      workflowData = await persistence.getWorkflowData<TestWorkflowData, TestCommand>(
        TestWorkflowData,
        propertyMapping,
        message
      )
    })

    afterAll(async () => {
      await bus.stop()
    })

    it('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data).toMatchObject({ property1: message.property1 })
    })
  })

})
