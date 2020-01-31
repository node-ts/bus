import { WorkflowData, WorkflowDataConstructor } from '../workflow-data'
import { WorkflowConstructor } from '../workflow'
import { PropertyObject } from '../../utility'
import { injectable, inject, interfaces } from 'inversify'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { Message } from '@node-ts/bus-messages'
import { HandlerRegistry, BUS_SYMBOLS, ClassConstructor } from '@node-ts/bus-core'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { BUS_WORKFLOW_SYMBOLS, BUS_WORKFLOW_INTERNAL_SYMBOLS } from '../../bus-workflow-symbols'
import { Persistence } from '../persistence'
import { StartedByProxy } from './started-by-proxy'
import { HandlesProxy } from './handles-proxy'
import { WorkflowStartedByMetadata } from '../decorators/started-by'
import { WorkflowHandlesMetadata } from '../decorators/handles'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import * as uuid from 'uuid'

interface WorkflowRegistration {
  workflowConstructor: WorkflowConstructor<WorkflowData>,
  workflowDataConstructor: WorkflowDataConstructor
}

/**
 * The central workflow registry that holds all workflows managed by the application. This includes
 *   - the list of workflows
 *   - what messages start the workflow
 *   - what messages are handled by each workflow
 */
@injectable()
export class WorkflowRegistry {

  private workflowRegistry: WorkflowRegistration[] = []
  private isInitialized = false
  private isInitializing = false

  constructor (
    @inject(BUS_SYMBOLS.HandlerRegistry) private readonly handlerRegistry: HandlerRegistry,
    @inject(BUS_WORKFLOW_SYMBOLS.Persistence) private readonly persistence: Persistence,
    @inject(BUS_WORKFLOW_INTERNAL_SYMBOLS.StartedByProxy) private readonly startedByFactory: (
        workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
        handler: WorkflowHandlerFn<Message, WorkflowData>
      ) => StartedByProxy<Message, WorkflowData>,
    @inject(BUS_WORKFLOW_INTERNAL_SYMBOLS.HandlesProxy) private readonly handlesFactory: (
      handler: WorkflowHandlerFn<Message, WorkflowData>,
      workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
      messageMapping: MessageWorkflowMapping<Message, WorkflowData>
    ) => HandlesProxy<Message, WorkflowData>,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  register<TWorkflowData extends WorkflowData> (
    workflowConstructor: WorkflowConstructor<TWorkflowData>,
    workflowDataConstructor: ClassConstructor<TWorkflowData>
  ): void {
    if (this.isInitialized) {
      throw new Error(
        `Attempted to register workflow (${workflowConstructor.name}) after workflows have been initialized`
      )
    }

    const duplicateWorkflowName = this.workflowRegistry
      .some(r => r.workflowConstructor.name === workflowConstructor.name)

    if (duplicateWorkflowName) {
      throw new Error(`Attempted to register two workflows with the same name (${workflowConstructor.name})`)
    }

    this.workflowRegistry.push({
      workflowConstructor,
      workflowDataConstructor
    })
  }

  /**
   * Initialize all services that are used to support workflows. This registers all messages subscribed to
   * in workflows as handlers with the bus, as well as initializing the persistence service so that workflow
   * states can be stored.
   *
   * This should be called once as the application is starting.
   */
  async initializeWorkflows (): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      throw new Error('Attempted to initialize workflow registry after it has already been initialized.')
    }

    this.isInitializing = true
    this.logger.info('Initializing workflows...')

    if (this.persistence.initialize) {
      await this.persistence.initialize()
    }

    for (const registration of this.workflowRegistry) {
      const startedByHandlers = WorkflowStartedByMetadata.getSteps(registration.workflowConstructor)
      this.registerStartedBy(startedByHandlers, registration)

      const messageHandlers = WorkflowHandlesMetadata.getSteps(registration.workflowConstructor)
      this.registerHandles(messageHandlers, registration)

      const messageWorkflowMappings = messageHandlers.map(s => s.messageWorkflowMapping)
      await this.persistence.initializeWorkflow(registration.workflowDataConstructor, messageWorkflowMappings)
      this.logger.debug('Workflow initialized', { workflowName: registration.workflowConstructor.name })
    }

    this.workflowRegistry = []
    this.isInitialized = true
    this.isInitializing = false
    this.logger.info('Workflows initialized')
  }

  async dispose (): Promise<void> {
    if (this.persistence.dispose) {
      await this.persistence.dispose()
    }
  }

  private registerStartedBy (
    startedByHandlers: WorkflowStartedByMetadata[],
    registration: WorkflowRegistration
  ): void {
    if (!startedByHandlers.length) {
      throw new Error(`Workflow ${registration.workflowConstructor.name} does not have a started by step`)
    }

    startedByHandlers.forEach(step => {
      const messageName = new step.messageConstructor().$name
      const handlerFactory = (context: interfaces.Context) => {
        const workflow = context.container.resolve(registration.workflowConstructor) as PropertyObject
        type HandlerFn = WorkflowHandlerFn<Message, WorkflowData>
        return this.startedByFactory(
          registration.workflowDataConstructor,
          (workflow[step.propertyKey] as HandlerFn).bind(workflow) as HandlerFn
        )
      }

      this.handlerRegistry.register(
        m => m.$name === messageName,
        Symbol.for(`node-ts/bus/workflow/${registration.workflowConstructor.name}-${messageName}-started-by-proxy`),
        handlerFactory,
        step.messageConstructor
      )
    })
  }

  private registerHandles (
    messageHandlers: WorkflowHandlesMetadata[],
    registration: WorkflowRegistration
  ): void {
    messageHandlers.forEach(step => {
      const messageName = new step.messageConstructor().$name

      const handler = (context: interfaces.Context) => {
        const workflow = context.container.resolve(registration.workflowConstructor) as PropertyObject
        type HandlerFn = WorkflowHandlerFn<Message, WorkflowData>
        return this.handlesFactory(
          (workflow[step.propertyKey] as HandlerFn).bind(workflow) as HandlerFn,
          registration.workflowDataConstructor,
          step.messageWorkflowMapping
        )
      }

      this.handlerRegistry.register(
        m => m.$name === messageName,
        Symbol.for(`node-ts/bus/workflow/${registration.workflowConstructor.name}-${messageName}-handles-proxy`),
        handler,
        step.messageConstructor
      )
    })
  }
}
