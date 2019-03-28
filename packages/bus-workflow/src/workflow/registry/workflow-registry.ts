import { WorkflowData, WorkflowDataConstructor } from '../workflow-data'
import { WorkflowConstructor } from '../workflow'
import { ClassConstructor, PropertyObject } from '../../utility'
import { injectable, inject, interfaces } from 'inversify'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { Message } from '@node-ts/bus-messages'
import { HandlerRegistry, BUS_SYMBOLS } from '@node-ts/bus-core'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WORKFLOW_SYMBOLS, WORKFLOW_INTERNAL_SYMBOLS } from '../../workflow-symbols'
import { Persistence } from '../persistence'
import { StartedByProxy } from './started-by-proxy'
import { HandlesProxy } from './handles-proxy'
import { WorkflowStartedByMetadata } from '../decorators/started-by'
import { WorkflowHandlesMetadata } from '../decorators/handles'

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
    @inject(WORKFLOW_SYMBOLS.Persistence) private readonly persistence: Persistence,
    @inject(WORKFLOW_INTERNAL_SYMBOLS.StartedByProxy) private readonly startedByFactory: (
        dataConstructor: WorkflowDataConstructor<WorkflowData>,
        handler: WorkflowHandlerFn<Message, WorkflowData>
      ) => StartedByProxy<Message, WorkflowData>,
    @inject(WORKFLOW_INTERNAL_SYMBOLS.HandlesProxy) private readonly handlesFactory: (
      handler: WorkflowHandlerFn<Message, WorkflowData>,
      dataConstructor: WorkflowDataConstructor<WorkflowData>,
      messageMapper: MessageWorkflowMapping<Message, WorkflowData>
    ) => HandlesProxy<Message, WorkflowData>
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

  async initializeWorkflows (): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      throw new Error('Attempted to initialize workflow registry after it has already been initialized.')
    }

    this.isInitializing = true

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
    }

    this.workflowRegistry = []
    this.isInitialized = true
    this.isInitializing = false
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
      const handler = (context: interfaces.Context) => {
        const workflow = context.container.resolve(registration.workflowConstructor) as PropertyObject
        type HandlerFn = WorkflowHandlerFn<Message, WorkflowData>
        return this.startedByFactory(
          registration.workflowDataConstructor,
          (workflow[step.propertyKey] as HandlerFn).bind(workflow) as HandlerFn
        )
      }

      this.handlerRegistry.register(
        messageName,
        Symbol.for(`node-ts/bus/workflow/${messageName}-started-by-proxy`),
        handler,
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
        messageName,
        Symbol.for(`node-ts/bus/workflow/${messageName}-handles-proxy`),
        handler,
        step.messageConstructor
      )
    })
  }
}
