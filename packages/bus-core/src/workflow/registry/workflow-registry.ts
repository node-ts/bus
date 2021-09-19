import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import * as uuid from 'uuid'
import { Workflow, OnWhenHandler, WorkflowMapper } from '../workflow'
import { getPersistence } from '../persistence/persistence'
import { ClassConstructor } from '../../util'
import { handlerRegistry } from '../../handler/handler-registry'
import { getLogger } from '../../logger'
import { PersistenceNotConfigured } from '../persistence/error'
import { WorkflowAlreadyInitialized } from '../error'
import { messageHandlingContext } from '../../message-handling-context'
import { ContainerAdapter } from '../../container'

const logger = () => getLogger('@node-ts/bus-core:workflow-registry')

const createWorkflowState = <TWorkflowState extends WorkflowState> (workflowStateType: ClassConstructor<TWorkflowState>) => {
  const data = new workflowStateType()
  data.$status = WorkflowStatus.Running
  data.$workflowId = uuid.v4()
  logger().debug('Created new workflow state', { workflowId: data.$workflowId, workflowStateType })
  return data
}

/**
 * Creates a new handling context for a single workflow. This is used so
 * that the `$workflowId` is attached to outgoing messages in sticky
 * attributes. This allows message chains to be automatically mapped
 * back to the workflow if handled.
 */
const startWorkflowHandlingContext = (workflowState: WorkflowState) => {
  logger().debug('Starting new workflow handling context', { workflowState })
  const handlingContext = messageHandlingContext.get()!.message
  const workflowHandlingContext = JSON.parse(JSON.stringify(handlingContext)) as typeof handlingContext
  workflowHandlingContext.attributes.stickyAttributes.workflowId = workflowState.$workflowId
  messageHandlingContext.set(workflowHandlingContext)
}

const endWorkflowHandlingContext = () => messageHandlingContext.destroy()

const dispatchMessageToWorkflow = async (
  message: Message,
  attributes: MessageAttributes,
  workflowCtor: ClassConstructor<Workflow<WorkflowState>>,
  workflowState: WorkflowState,
  workflowStateConstructor: ClassConstructor<WorkflowState>,
  workflowHandler: keyof Workflow<WorkflowState>,
  container: ContainerAdapter | undefined
) => {
  logger().debug('Dispatching message to workflow', { msg: message, workflow: workflowCtor })
  const workflow = container
    ? container.get(workflowCtor)
    : new workflowCtor()

  const immutableWorkflowState = Object.freeze({...workflowState})
  const handler = workflow[workflowHandler] as Function
  const workflowStateOutput = await handler.bind(workflow)(message, immutableWorkflowState, attributes)

  const workflowName = workflowCtor.prototype.name
  if (workflowStateOutput && workflowStateOutput.$status === WorkflowStatus.Discard) {
    logger().debug(
      'Workflow step is discarding state changes. State changes will not be persisted',
      { workflowId: immutableWorkflowState.$workflowId, workflowName }
    )
  } else if (workflowStateOutput) {
    logger().debug(
      'Changes detected in workflow state and will be persisted.',
      {
        workflowId: immutableWorkflowState.$workflowId,
        workflowName,
        changes: workflowStateOutput
      }
    )

    const updatedWorkflowState = Object.assign(
      new workflowStateConstructor(),
      workflowState,
      workflowStateOutput
    )

    try {
      await persist(updatedWorkflowState)
    } catch (error) {
      logger().warn(
        'Error persisting workflow state',
        { err: error, workflow: workflowName }
      )
      throw error
    }
  } else {
    logger().trace('No changes detected in workflow state.', { workflowId: immutableWorkflowState.$workflowId })
  }
}

const persist = async (data: WorkflowState) => {
  try {
    await getPersistence().saveWorkflowState(data)
    logger().info('Workflow state saved', { data })
  } catch (err) {
    logger().error('Error persisting workflow state', { err })
    throw err
  }
}

/**
 * A default lookup that will match a workflow by its id with the workflowId
 * stored in the sticky attributes
 */
const workflowLookup: MessageWorkflowMapping = {
  lookup: (_, attributes) => attributes.stickyAttributes.workflowId as string | undefined,
  mapsTo: '$workflowId'
}

/**
 * The central workflow registry that holds all workflows managed by the application. This includes
 *   - the list of workflows
 *   - what messages start the workflow
 *   - what messages are handled by each workflow
 * This registry is also responsible for dispatching messages to workflows as they are received.
 */
export class WorkflowRegistry {

  private workflowRegistry: ClassConstructor<Workflow<WorkflowState>>[] = []
  private isInitialized = false
  private isInitializing = false

  async register (workflow: ClassConstructor<Workflow<WorkflowState>>): Promise<void> {
    logger().debug('Registering workflow', { workflow })
    if (this.isInitialized) {
      throw new Error(
        `Attempted to register workflow (${workflow.prototype.constructor.name}) after workflows have been initialized`
      )
    }

    const duplicateWorkflowName = this.workflowRegistry
      .some(r => r.prototype.constructor.name === workflow.prototype.constructor.name)

    if (duplicateWorkflowName) {
      throw new Error(`Attempted to register two workflows with the same name (${workflow.prototype.constructor.name})`)
    }

    this.workflowRegistry.push(workflow)
    logger().info('Workflow registered', { workflow: workflow.prototype.constructor.name })
  }

  /**
   * Initialize all services that are used to support workflows. This registers all messages subscribed to
   * in workflows as handlers with the bus, as well as initializing the persistence service so that workflow
   * states can be stored.
   *
   * This should be called once as the application is starting.
   */
  async initialize (container: ContainerAdapter | undefined): Promise<void> {
    if (this.workflowRegistry.length === 0) {
      logger().info('No workflows registered, skipping this step.')
      return
    }

    if (this.isInitialized || this.isInitializing) {
      throw new WorkflowAlreadyInitialized()
    }

    logger().info('Initializing workflows...', { numWorkflows: this.workflowRegistry.length })
    this.isInitializing = true

    for (const WorkflowCtor of this.workflowRegistry) {
      logger().debug('Initializing workflow', { workflow: WorkflowCtor.prototype.constructor.name })

      const workflowInstance = new WorkflowCtor()
      const mapper = new WorkflowMapper(WorkflowCtor)
      workflowInstance.configureWorkflow(mapper)

      if (!mapper.workflowStateCtor) {
        throw new Error('Workflow state not provided. Use .withState()')
      }

      this.registerFnStartedBy(mapper, container)
      this.registerFnHandles(mapper, WorkflowCtor, container)

      const messageWorkflowMappings: MessageWorkflowMapping[] = Array.from<[ClassConstructor<Message>, OnWhenHandler], MessageWorkflowMapping>(
        mapper.onWhen,
        ([_, onWhenHandler]) => onWhenHandler.customLookup || workflowLookup
      )
      await getPersistence().initializeWorkflow(mapper.workflowStateCtor!, messageWorkflowMappings)
      logger().debug('Workflow initialized', { workflowName: WorkflowCtor.prototype.name })
    }

    this.workflowRegistry = []

    if (getPersistence().initialize) {
      logger().info('Initializing persistence...')
      await getPersistence().initialize!()
    }

    this.isInitialized = true
    this.isInitializing = false
    logger().info('Workflows initialized')
  }

  async dispose (): Promise<void> {
    logger().debug('Disposing workflow registry')
    try {
      if (getPersistence().dispose) {
        await getPersistence().dispose!()
      }
    } catch (error) {
      if (error instanceof PersistenceNotConfigured) {
        return
      }
      throw error
    }
  }

  private registerFnStartedBy (
    mapper: WorkflowMapper<any, any>,
    container: ContainerAdapter | undefined
  ): void {
    logger().debug(
      'Registering started by handlers for workflow',
      {
        numHandlers: mapper.onStartedBy.size
      }
    )
    mapper.onStartedBy.forEach((options, messageConstructor) =>
      handlerRegistry.register(
        messageConstructor,
        async (message, messageAttributes) => {
          logger().debug(
            'Starting new workflow instance',
            { workflow: options.workflowCtor, msg: message }
          )
          const workflowState = createWorkflowState(mapper.workflowStateCtor!)
          const immutableWorkflowState = Object.freeze({...workflowState})
          startWorkflowHandlingContext(immutableWorkflowState)
          try {
            const workflow = container
              ? container.get(options.workflowCtor)
              : new options.workflowCtor()
            const handler = workflow[options.workflowHandler as keyof Workflow<WorkflowState>] as Function
            const result = await handler.bind(workflow)(message, immutableWorkflowState, messageAttributes)

            logger().debug(
              'Finished handling for new workflow',
              { workflow: options.workflowCtor, msg: message, workflowState: result }
            )

            if (result) {
              await getPersistence().saveWorkflowState({
                ...workflowState,
                ...result
              })
            }
          } finally {
            endWorkflowHandlingContext()
          }
        }
    ))
  }

  private registerFnHandles (
    mapper: WorkflowMapper<WorkflowState, Workflow<WorkflowState>>,
    workflowCtor: ClassConstructor<Workflow<WorkflowState>>,
    container: ContainerAdapter | undefined
  ): void {
    logger().debug(
      'Registering handles for workflow',
      {
        workflow: workflowCtor,
        numHandlers: mapper.onWhen.size
      }
    )

    mapper.onWhen.forEach((handler, messageConstructor) => {
      // TODO implement outbound tagging of workflowId to stickyAttributes
      const messageMapping = handler.customLookup || workflowLookup

      handlerRegistry.register(
        messageConstructor,
        async (message, attributes) => {
          logger().debug('Getting workflow state for message handler', { msg: message, workflow: workflowCtor })
          const workflowState = await getPersistence().getWorkflowState<WorkflowState, Message>(
            mapper.workflowStateCtor!,
            messageMapping,
            message,
            attributes,
            false
          )

          if (!workflowState.length) {
            logger().info('No existing workflow state found for message. Ignoring.', { message })
            return
          }

          const workflowHandlers = workflowState.map(async state => {
            try {
              startWorkflowHandlingContext(state)
              await dispatchMessageToWorkflow(
                message,
                attributes,
                workflowCtor,
                state,
                mapper.workflowStateCtor!,
                handler.workflowHandler,
                container
              )
            } finally {
              endWorkflowHandlingContext()
            }
          })

          await Promise.all(workflowHandlers)
        }
      )
    })
  }
}
