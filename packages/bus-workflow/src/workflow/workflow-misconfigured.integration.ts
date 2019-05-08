import { Container } from 'inversify'
import { BusModule, Bus, BUS_SYMBOLS, ApplicationBootstrap } from '@node-ts/bus-core'
import { Persistence } from './persistence'
import { BUS_WORKFLOW_SYMBOLS } from '../bus-workflow-symbols'
import { TestCommand } from '../test'
import { sleep } from '../utility'
import { WorkflowRegistry } from './registry/workflow-registry'
import { BusWorkflowModule } from '../bus-workflow-module'
import { LoggerModule, LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { Mock, IMock, Times, It } from 'typemoq'
import {
  TestWorkflowMisconfigured,
  TestWorkflowMisconfiguredData
} from '../test/test-workflow-misconfigured'

describe('WorkflowMisconfigured', () => {
  let container: Container
  let persistence: Persistence
  let bootstrap: ApplicationBootstrap
  let logger: IMock<Logger>

  const command = new TestCommand('abc')
  let bus: Bus
  const CONSUME_TIMEOUT = 1000

  beforeAll(async () => {
    container = new Container()
    container.load(new LoggerModule())
    container.load(new BusModule())
    container.load(new BusWorkflowModule())
    logger = Mock.ofType<Logger>()
    container.rebind(LOGGER_SYMBOLS.Logger).toConstantValue(logger.object)

    persistence = container.get<Persistence>(BUS_WORKFLOW_SYMBOLS.Persistence)

    const workflowRegistry = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflowRegistry.register(TestWorkflowMisconfigured, TestWorkflowMisconfiguredData)
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

  describe('when a misconfigured workflow is invoked', () => {
    it('should log an error', () => {
      logger.verify(
        l => l.error('Could not get handler for message from the IoC container.', It.isAny()),
        Times.atLeastOnce()
      )
    })
  })
})
