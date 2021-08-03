import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import * as uuid from 'uuid'
import { Workflow, WhenHandler, OnWhenHandler, WorkflowMapper, WorkflowHandler } from '../workflow'
import { getPersistence } from '../persistence/persistence'
import { ClassConstructor } from '../../util'
import { handlerRegistry } from '../../handler/handler-registry'
import { getLogger } from '../../logger'
import { PersistenceNotConfigured } from '../persistence/error'
import { WorkflowAlreadyInitialized } from '../error'
import { HandlerContext } from '../../handler'
import { messageHandlingContext } from '../../message-handling-context'

const logger = getLogger('@node-ts/bus-core:workflow-registry')

const createWorkflowState = <TWorkflowState extends WorkflowState> (workflowStateType: ClassConstructor<TWorkflowState>) => {
  const data = new workflowStateType()
  data.$status = WorkflowStatus.Running
  data.$workflowId = uuid.v4()
  return data
}

/**
 * Creates a new handling context for a single workflow. This is used so
 * that the `$workflowId` is attached to outgoing messages in sticky
 * attributes. This allows message chains to be automatically mapped
 * back to the workflow if handled.
 */
const startWorkflowHandlingContext = (workflowState: WorkflowState) => {
  const handlingContext = messageHandlingContext.get()!.message
  const workflowHandlingContext = JSON.parse(JSON.stringify(handlingContext)) as typeof handlingContext
  workflowHandlingContext.attributes.stickyAttributes.workflowId = workflowState.$workflowId
  messageHandlingContext.set(workflowHandlingContext)
}

const endWorkflowHandlingContext = () => messageHandlingContext.destroy()

const dispatchMessageToWorkflow = async (
  context: HandlerContext<Message>,
  workflowCtor: ClassConstructor<Workflow<WorkflowState>>,
  workflowState: WorkflowState,
  workflowStateConstructor: ClassConstructor<WorkflowState>,
  workflowHandler: keyof Workflow<WorkflowState>
) => {
  const immutableWorkflowState = Object.freeze({...workflowState})
  const workflow = new workflowCtor()
  const handler = workflow[workflowHandler] as Function
  const workflowStateOutput = await handler.bind(workflow)(context, immutableWorkflowState)

  const workflowName = workflowCtor.prototype.name
  if (workflowStateOutput && workflowStateOutput.$status === WorkflowStatus.Discard) {
    logger.debug(
      'Workflow step is discarding state changes. State changes will not be persisted',
      { workflowId: immutableWorkflowState.$workflowId, workflowName }
    )
  } else if (workflowStateOutput) {
    logger.debug(
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
      logger.warn(
        'Error persisting workflow state',
        { err: error, workflow: workflowName }
      )
      throw error
    }
  } else {
    logger.trace('No changes detected in workflow state.', { workflowId: immutableWorkflowState.$workflowId })
  }
}

const persist = async (data: WorkflowState) => {
  try {
    await getPersistence().saveWorkflowState(data)
    logger.info('Saving workflow state', { data })
  } catch (err) {
    logger.error('Error persisting workflow state', { err })
    throw err
  }
}

const workflowLookup: MessageWorkflowMapping = {
  lookup: (context: HandlerContext<Message>) => context.attributes.stickyAttributes.workflowId as string | undefined,
  mapsTo: '$workflowId'
}

/**
 * The central workflow registry that holds all workflows managed by the application. This includes
 *   - the list of workflows
 *   - what messages start the workflow
 *   - what messages are handled by each workflow
 * This registry is also responsible for dispatching messages to workflows as they are received.
 */
class WorkflowRegistry {

  private workflowRegistry: ClassConstructor<Workflow<WorkflowState>>[] = []
  private isInitialized = false
  private isInitializing = false

  async register (workflow: ClassConstructor<Workflow<WorkflowState>>): Promise<void> {
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
      logger.info('No workflows registered, skipping this step.')
      return
    }

    if (this.isInitialized || this.isInitializing) {
      throw new WorkflowAlreadyInitialized()
    }

    this.isInitializing = true
    logger.info('Initializing workflows...')

    for (const WorkflowCtor of this.workflowRegistry) {

      const workflowInstance = new WorkflowCtor()
      const mapper = new WorkflowMapper(WorkflowCtor)
      workflowInstance.configureWorkflow(mapper)

      if (!mapper.workflowStateCtor) {
        throw new Error('Workflow state not provided. Use .withState()')
      }

      this.registerFnStartedBy(mapper)
      this.registerFnHandles(mapper, WorkflowCtor)

      const messageWorkflowMappings: MessageWorkflowMapping[] = Array.from<[ClassConstructor<Message>, OnWhenHandler], MessageWorkflowMapping>(
        mapper.onWhen,
        ([_, onWhenHandler]) => onWhenHandler.customLookup || workflowLookup
      )
      await getPersistence().initializeWorkflow(mapper.workflowStateCtor!, messageWorkflowMappings)
      logger.debug('Workflow initialized', { workflowName: WorkflowCtor.prototype.name })
    }

    this.workflowRegistry = []

    if (getPersistence().initialize) {
      await getPersistence().initialize!()
    }

    this.isInitialized = true
    this.isInitializing = false
    logger.info('Workflows initialized')
  }

  async dispose (): Promise<void> {
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
    mapper: WorkflowMapper<any, any>
  ): void {
    mapper.onStartedBy.forEach((options, messageConstructor) =>
      handlerRegistry.register(
        messageConstructor,
        async (context) => {
          const workflowState = createWorkflowState(mapper.workflowStateCtor!)
          const immutableWorkflowState = Object.freeze({...workflowState})
          startWorkflowHandlingContext(immutableWorkflowState)
          try {
            const workflow = new options.workflowCtor()
            const handler = workflow[options.workflowHandler as keyof Workflow<WorkflowState>] as Function
            const result = await handler.bind(workflow)(context, immutableWorkflowState)
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
    workflowCtor: ClassConstructor<Workflow<WorkflowState>>
  ): void {
    mapper.onWhen.forEach((handler, messageConstructor) => {
      // TODO implement outbound tagging of workflowId to stickyAttributes
      const messageMapping = handler.customLookup || workflowLookup

      handlerRegistry.register(
        messageConstructor,
        async (context) => {
          const { message, attributes } = context
          const workflowState = await getPersistence().getWorkflowState<WorkflowState, Message>(
            mapper.workflowStateCtor!,
            messageMapping,
            message,
            attributes,
            false
          )

          if (!workflowState.length) {
            logger.info('No existing workflow state found for message. Ignoring.', { message })
            return
          }

          const workflowHandlers = workflowState.map(async state => {
            try {
              startWorkflowHandlingContext(state)
              await dispatchMessageToWorkflow(
                context,
                workflowCtor,
                state,
                mapper.workflowStateCtor!,
                handler.workflowHandler
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

export const workflowRegistry = new WorkflowRegistry()
