import { WorkflowData, WorkflowDataConstructor, WorkflowStatus } from '../workflow-data'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { Message } from '@node-ts/bus-messages'
import { handlerRegistry, ClassConstructor, getLogger } from '@node-ts/bus-core'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Persistence } from '../persistence'
import { StartedByProxy } from './started-by-proxy'
import { HandlesProxy } from './handles-proxy'
import { WorkflowStartedByMetadata } from '../decorators/started-by'
import { WorkflowHandlesMetadata } from '../decorators/handles'
import * as uuid from 'uuid'
import { Workflow, WhenHandler, OnWhenHandler, WorkflowConstructor } from '../workflow'

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
class WorkflowRegistry {

  private workflowRegistry: WorkflowRegistration[] = []
  private isInitialized = false
  private isInitializing = false

  constructor (
    @inject(BUS_WORKFLOW_INTERNAL_SYMBOLS.StartedByProxy) private readonly startedByFactory: (
        workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
        handler: WorkflowHandlerFn<Message, WorkflowData>
      ) => StartedByProxy<Message, WorkflowData>,
    @inject(BUS_WORKFLOW_INTERNAL_SYMBOLS.HandlesProxy) private readonly handlesFactory: (
      handler: WorkflowHandlerFn<Message, WorkflowData>,
      workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
      messageMapping: MessageWorkflowMapping<Message, WorkflowData>
    ) => HandlesProxy<Message, WorkflowData>,
  ) {
  }

  async register (workflow: Workflow): Promise<void> {
    if (this.isInitialized) {
      throw new Error(
        `Attempted to register workflow (${workflow.workflowName}) after workflows have been initialized`
      )
    }

    const duplicateWorkflowName = this.workflowRegistry
      .some(r => r.workflowConstructor.name === workflow.workflowName)

    if (duplicateWorkflowName) {
      throw new Error(`Attempted to register two workflows with the same name (${workflow.workflowName})`)
    }


    // tslint:disable:max-classes-per-file
    class AssignmentWorkflowData {
      $workflowId: string
      $name = 'assignment'
      $status: WorkflowStatus
      $version: number
    }

    await this.persistence.initializeWorkflow(
      AssignmentWorkflowData,
      []
    )
  }

  /**
   * Initialize all services that are used to support workflows. This registers all messages subscribed to
   * in workflows as handlers with the bus, as well as initializing the persistence service so that workflow
   * states can be stored.
   *
   * This should be called once as the application is starting.
   */
  async initialize (): Promise<void> {
    if (this.workflowRegistry.length === 0) {
      getLogger().info('No workflows registered, skipping this step.')
      return
    }

    if (this.isInitialized || this.isInitializing) {
      throw new Error('Attempted to initialize workflow registry after it has already been initialized.')
    }

    this.isInitializing = true
    getLogger().info('Initializing workflows...')

    if (this.persistence.initialize) {
      await this.persistence.initialize()
    }

    for (const registration of this.workflowRegistry) {

      this.registerFnStartedBy(workflow.onStartedBy, workflow)
      this.registerFnHandles(workflow.onWhen, workflow)
      const startedByHandlers = WorkflowStartedByMetadata.getSteps(registration.workflowConstructor)
      this.registerStartedBy(startedByHandlers, registration)

      const messageHandlers = WorkflowHandlesMetadata.getSteps(registration.workflowConstructor)
      this.registerHandles(messageHandlers, registration)

      const messageWorkflowMappings = messageHandlers.map(s => s.messageWorkflowMapping)
      await this.persistence.initializeWorkflow(registration.workflowDataConstructor, messageWorkflowMappings)
      getLogger().debug('Workflow initialized', { workflowName: registration.workflowConstructor.name })
    }

    this.workflowRegistry = []
    this.isInitialized = true
    this.isInitializing = false
    getLogger().info('Workflows initialized')
  }

  async dispose (): Promise<void> {
    if (this.persistence.dispose) {
      await this.persistence.dispose()
    }
  }

  private registerFnStartedBy (
    startedByHandlers: Map<
      ClassConstructor<Message>,
      WhenHandler<Message, WorkflowData, {}> | undefined
    >,
    workflow: Workflow<WorkflowData, {}>
  ): void {
    startedByHandlers.forEach((handler, messageConstructor) => {
      const messageName = new messageConstructor().$name
      const handlerFactory = (context: interfaces.Context) => {
        const initialWorkflowData: WorkflowData = {
          $workflowId: uuid.v4(),
          $name: workflow.workflowName,
          $status: WorkflowStatus.Running,
          $version: 0
        }

        const dependencies = workflow.dependencyResolver
          ? workflow.dependencyResolver(context.container)
          : {}

        // TODO
        class AssignmentWorkflowData {
          $name: 'assignment'
        }
        return this.startedByFactory(
          AssignmentWorkflowData as ClassConstructor<WorkflowData>,
          (message, _, messageAttributes) => {
            const result = handler!({
              message,
              messageAttributes,
              state: initialWorkflowData,
              dependencies
            })
            return {
              ...result,
              ...initialWorkflowData
            }
          }
        )
      }

      handlerRegistry.register(
        messageName,
        Symbol.for(`node-ts/bus/workflow/${workflow.workflowName}-${messageName}-started-by-proxy`),
        handlerFactory,
        messageConstructor
      )
    })
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

      handlerRegistry.register(
        messageName,
        Symbol.for(`node-ts/bus/workflow/${registration.workflowConstructor.name}-${messageName}-started-by-proxy`),
        handlerFactory,
        step.messageConstructor
      )
    })
  }

  private registerFnHandles (
    whenHandlers: Map<
      ClassConstructor<Message>,
      OnWhenHandler
    >,
    workflow: Workflow<WorkflowData, {}>
  ): void {
    whenHandlers.forEach((handler, messageConstructor) => {
      const messageName = new messageConstructor().$name
      const handlerFactory = (context: interfaces.Context) => {
        const state: WorkflowData = {
          $workflowId: uuid.v4(),
          $name: workflow.workflowName,
          $status: WorkflowStatus.Running,
          $version: 1
        }

        const dependencies = workflow.dependencyResolver
          ? workflow.dependencyResolver(context.container)
          : {}

        // TODO
        class AssignmentWorkflowData {
          $name = 'assignment'
        }
        return this.handlesFactory(
          (message, _, messageAttributes) => handler.handler({
              message,
              messageAttributes,
              workflowState: state,
              dependencies
            }),
          AssignmentWorkflowData as ClassConstructor<WorkflowData>,
          new MessageWorkflowMapping<Message, WorkflowData>(
            handler.options.lookup,
            handler.options.mapsTo
          )
        )
      }

      handlerRegistry.register(
        messageName,
        Symbol.for(`node-ts/bus/workflow/${workflow.workflowName}-${messageName}-when-handler-proxy`),
        handlerFactory,
        messageConstructor
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
      handlerRegistry.register(
        messageName,
        Symbol.for(`node-ts/bus/workflow/${registration.workflowConstructor.name}-${messageName}-handles-proxy`),
        handler,
        step.messageConstructor
      )
    })
  }
}

export const workflowRegistry = new WorkflowRegistry()
