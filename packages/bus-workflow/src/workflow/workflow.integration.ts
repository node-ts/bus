import { Container } from 'inversify'
import { BusModule, Bus, BUS_SYMBOLS, ApplicationBootstrap, MessageOptions } from '@node-ts/bus-core'
import { Persistence } from './persistence'
import { BUS_WORKFLOW_SYMBOLS } from '../bus-workflow-symbols'
import { TestCommand, TestWorkflowData, TestWorkflow, TaskRan } from '../test'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { sleep } from '../utility'
import { WorkflowStatus } from './workflow-data'
import { WorkflowRegistry } from './registry/workflow-registry'
import { BusWorkflowModule } from '../bus-workflow-module'
import { LoggerModule, LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import {
  TestWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from '../test/test-workflow-startedby-completes'
import {
  TestWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from '../test/test-workflow-startedby-discard'
import { Mock } from 'typemoq'

describe('Workflow', () => {
  let container: Container
  let persistence: Persistence
  let bootstrap: ApplicationBootstrap

  const command = new TestCommand('abc')
  let bus: Bus
  const CONSUME_TIMEOUT = 500

  beforeAll(async () => {
    container = new Container()
    container.load(new LoggerModule())
    container.load(new BusModule())
    container.load(new BusWorkflowModule())
    container.rebind(LOGGER_SYMBOLS.Logger).toConstantValue(Mock.ofType<Logger>().object)

    persistence = container.get<Persistence>(BUS_WORKFLOW_SYMBOLS.Persistence)

    const workflowRegistry = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflowRegistry.register(TestWorkflow, TestWorkflowData)
    workflowRegistry.register(TestWorkflowStartedByCompletes, TestWorkflowStartedByCompletesData)
    workflowRegistry.register(TestWorkflowStartedByDiscard, TestWorkflowStartedByDiscardData)
    await workflowRegistry.initializeWorkflows()

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)

    bus = container.get(BUS_SYMBOLS.Bus)
    await bus.send(command)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bootstrap.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData> (
      cmd => cmd.property1,
      'property1'
    )
    let workflowData: TestWorkflowData[]
    const messageOptions = new MessageOptions()

    beforeAll(async () => {
      workflowData = await persistence.getWorkflowData<TestWorkflowData, TestCommand>(
        TestWorkflowData,
        propertyMapping,
        command,
        messageOptions
      )
    })

    it('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(0)
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
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(finalWorkflowData).toHaveLength(1)
      })

      it('should mark the workflow as complete', () => {
        const data = finalWorkflowData[0]
        expect(data.$status).toEqual(WorkflowStatus.Complete)
      })
    })
  })

  describe('when a workflow is completed in a StartedBy handler', () => {
    const messageOptions = new MessageOptions()
    const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowStartedByCompletesData> (
      cmd => cmd.property1,
      'property1'
    )

    it('should persist the workflow as completed', async () => {
      const workflowData = await persistence.getWorkflowData<TestWorkflowStartedByCompletesData, TestCommand>(
        TestWorkflowStartedByCompletesData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data.$status).toEqual(WorkflowStatus.Complete)
    })
  })

  describe('when a StartedBy handler returns a discardStep', () => {
    const messageOptions = new MessageOptions()
    const propertyMapping = new MessageWorkflowMapping<TestCommand, TestWorkflowStartedByDiscardData> (
      cmd => cmd.property1,
      'property1'
    )

    it('should not persist the workflow', async () => {
      const workflowData = await persistence.getWorkflowData<TestWorkflowStartedByDiscardData, TestCommand>(
        TestWorkflowStartedByDiscardData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowData).toHaveLength(0)
    })
  })
})
