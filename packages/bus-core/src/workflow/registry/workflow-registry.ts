import { WorkflowData, WorkflowStatus } from '../workflow-data'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import * as uuid from 'uuid'
import { Workflow, WhenHandler, OnWhenHandler } from '../workflow'
import { getPersistence } from '../persistence/persistence'
import { ClassConstructor, getLogger } from '../../util'
import { handlerRegistry } from '../../handler/handler-registry'

const createWorkflowState = <TWorkflowData extends WorkflowData> (workflowStateType: ClassConstructor<TWorkflowData>) => {
  const data = new workflowStateType()
  data.$status = WorkflowStatus.Running
  data.$workflowId = uuid.v4()
  return data
}

const dispatchMessageToWorkflow = async (
  message: Message,
  context: MessageAttributes,
  workflowName: string,
  workflowData: WorkflowData,
  workflowDataConstructor: ClassConstructor<WorkflowData>,
  handler: WhenHandler<Message, WorkflowData>
) => {
  const immutableWorkflowData = Object.freeze({...workflowData})
  const workflowDataOutput = await handler({
    message,
    context,
    state: immutableWorkflowData
  })

  if (workflowDataOutput && workflowDataOutput.$status === WorkflowStatus.Discard) {
    getLogger().debug(
      'Workflow step is discarding state changes. State changes will not be persisted',
      { workflowId: immutableWorkflowData.$workflowId, workflowName }
    )
  } else if (workflowDataOutput) {
    getLogger().debug(
      'Changes detected in workflow data and will be persisted.',
      {
        workflowId: immutableWorkflowData.$workflowId,
        workflowName,
        changes: workflowDataOutput
      }
    )

    const updatedWorkflowData = Object.assign(
      new workflowDataConstructor(),
      workflowData,
      workflowDataOutput
    )

    try {
      await persist(updatedWorkflowData)
    } catch (error) {
      getLogger().warn(
        'Error persisting workflow data',
        { err: error, workflow: workflowName }
      )
      throw error
    }
  } else {
    getLogger().trace('No changes detected in workflow data.', { workflowId: immutableWorkflowData.$workflowId })
  }
}

const persist = async (data: WorkflowData) => {
  try {
    await getPersistence().saveWorkflowData(data)
    getLogger().info('Saving workflow data', { data })
  } catch (err) {
    getLogger().error('Error persisting workflow data', { err })
    throw err
  }
}

/**
 * The central workflow registry that holds all workflows managed by the application. This includes
 *   - the list of workflows
 *   - what messages start the workflow
 *   - what messages are handled by each workflow
 */
class WorkflowRegistry {

  private workflowRegistry: Workflow[] = []
  private isInitialized = false
  private isInitializing = false

  async register (workflow: Workflow): Promise<void> {
    if (this.isInitialized) {
      throw new Error(
        `Attempted to register workflow (${workflow.workflowName}) after workflows have been initialized`
      )
    }

    const duplicateWorkflowName = this.workflowRegistry
      .some(r => r.workflowName === workflow.workflowName)

    if (duplicateWorkflowName) {
      throw new Error(`Attempted to register two workflows with the same name (${workflow.workflowName})`)
    }

    this.workflowRegistry.push(workflow)
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

    for (const workflow of this.workflowRegistry) {

      this.registerFnStartedBy(workflow)
      this.registerFnHandles(workflow)

      const messageWorkflowMappings: MessageWorkflowMapping[] = Array.from<[ClassConstructor<Message>, OnWhenHandler], MessageWorkflowMapping>(
        workflow.onWhen,
        ([_, onWhenHandler]) => onWhenHandler.options
      )
      await getPersistence().initializeWorkflow(workflow.stateType, messageWorkflowMappings)
      getLogger().debug('Workflow initialized', { workflowName: workflow.workflowName })
    }

    this.workflowRegistry = []

    if (getPersistence().initialize) {
      await getPersistence().initialize!()
    }

    this.isInitialized = true
    this.isInitializing = false
    getLogger().info('Workflows initialized')
  }

  async dispose (): Promise<void> {
    if (getPersistence().dispose) {
      await getPersistence().dispose!()
    }
  }

  private registerFnStartedBy (
    workflow: Workflow
  ): void {
    workflow.onStartedBy.forEach((handler, messageConstructor) =>
      handlerRegistry.register(
        messageConstructor,
        async ({ message, context }) => {
          const workflowState = createWorkflowState(workflow.stateType)
          const immutableWorkflowState = Object.freeze({...workflowState})
          const result = await handler({ message, context, state: immutableWorkflowState })
          if (result) {
            await getPersistence().saveWorkflowData({
              ...workflowState,
              ...result
            })
          }
        }
    ))
  }

  private registerFnHandles (
    workflow: Workflow
  ): void {
    workflow.onWhen.forEach((handler, messageConstructor) => {
      const messageMapping: MessageWorkflowMapping<Message, WorkflowData> = {
        lookup: handler.options.lookup,
        mapsTo: handler.options.mapsTo
      }
      handlerRegistry.register(
        messageConstructor,
        async ({ message, context }) => {
          const workflowState = await getPersistence().getWorkflowData(
            workflow.stateType,
            messageMapping,
            message,
            context,
            false
          )

          if (!workflowState.length) {
            getLogger().info('No existing workflow data found for message. Ignoring.', { message })
            return
          }

          const workflowHandlers = workflowState.map(state => dispatchMessageToWorkflow(
            message,
            context,
            workflow.workflowName,
            state,
            workflow.stateType,
            handler.handler
          ))

          await Promise.all(workflowHandlers)
        }
      )
    })
  }
}

export const workflowRegistry = new WorkflowRegistry()
