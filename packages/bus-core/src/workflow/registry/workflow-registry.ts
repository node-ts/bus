import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import * as uuid from 'uuid'
import { Workflow, OnWhenHandler, WorkflowMapper } from '../workflow'
import { ClassConstructor, CoreDependencies } from '../../util'
import { PersistenceNotConfigured } from '../persistence/error'
import { WorkflowAlreadyInitialized } from '../error'
import { messageHandlingContext } from '../../message-handling-context'
import { ContainerAdapter } from '../../container'
import { HandlerDispatchRejected, HandlerRegistry } from '../../handler'
import { Logger } from '../../logger'
import { Persistence } from '../persistence'

/**
 * A default lookup that will match a workflow by its id with the workflowId
 * stored in the sticky attributes
 */
const workflowLookup: MessageWorkflowMapping = {
  lookup: (
    _: Message,
    attributes: MessageAttributes<{}, { workflowId: string }>
  ) => attributes.stickyAttributes.workflowId as string | undefined,
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
  private logger: Logger
  private persistence: Persistence

  prepare(coreDependencies: CoreDependencies, persistence: Persistence): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:workflow-registry'
    )
    this.persistence = persistence
  }

  async register(
    workflow: ClassConstructor<Workflow<WorkflowState>>
  ): Promise<void> {
    if (this.isInitialized) {
      throw new Error(
        `Attempted to register workflow (${workflow.prototype.constructor.name}) after workflows have been initialized`
      )
    }

    const duplicateWorkflowName = this.workflowRegistry.some(
      r => r.prototype.constructor.name === workflow.prototype.constructor.name
    )

    if (duplicateWorkflowName) {
      throw new Error(
        `Attempted to register two workflows with the same name (${workflow.prototype.constructor.name})`
      )
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
  async initialize(
    handlerRegistry: HandlerRegistry,
    container: ContainerAdapter | undefined
  ): Promise<void> {
    if (this.workflowRegistry.length === 0) {
      this.logger.info('No workflows registered, skipping this step.')
      return
    }

    if (this.isInitialized || this.isInitializing) {
      throw new WorkflowAlreadyInitialized()
    }

    this.logger.info('Initializing workflows...', {
      numWorkflows: this.workflowRegistry.length
    })
    this.isInitializing = true

    if (this.persistence.initialize) {
      this.logger.info('Initializing persistence...')
      await this.persistence.initialize!()
    }

    for (const WorkflowCtor of this.workflowRegistry) {
      this.logger.debug('Initializing workflow', {
        workflow: WorkflowCtor.prototype.constructor.name
      })

      let workflowInstance
      if (container) {
        const workflowInstanceFromContainer = container.get(WorkflowCtor)
        if (workflowInstanceFromContainer instanceof Promise) {
          workflowInstance = await workflowInstanceFromContainer
        } else {
          workflowInstance = workflowInstanceFromContainer
        }
      } else {
        workflowInstance = new WorkflowCtor()
      }
      const mapper = new WorkflowMapper(WorkflowCtor)
      workflowInstance.configureWorkflow(mapper)

      if (!mapper.workflowStateCtor) {
        throw new Error('Workflow state not provided. Use .withState()')
      }

      this.registerFnStartedBy(mapper, handlerRegistry, container)
      this.registerFnHandles(mapper, handlerRegistry, WorkflowCtor, container)

      const messageWorkflowMappings: MessageWorkflowMapping[] = Array.from<
        [ClassConstructor<Message>, OnWhenHandler],
        MessageWorkflowMapping
      >(
        mapper.onWhen,
        ([_, onWhenHandler]) => onWhenHandler.customLookup || workflowLookup
      )
      await this.persistence.initializeWorkflow(
        mapper.workflowStateCtor!,
        messageWorkflowMappings
      )
      this.logger.debug('Workflow initialized', {
        workflowName: WorkflowCtor.prototype.name
      })
    }

    this.workflowRegistry = []

    this.isInitialized = true
    this.isInitializing = false
    this.logger.info('Workflows initialized')
  }

  async dispose(): Promise<void> {
    const isPrepared = this.persistence !== undefined
    if (!isPrepared) {
      // If the registry has not been prepared, then there is no logger or persistence available
      return
    }

    this.logger.debug('Disposing workflow registry')
    try {
      if (this.persistence.dispose) {
        await this.persistence.dispose!()
      }
    } catch (error) {
      if (error instanceof PersistenceNotConfigured) {
        return
      }
      throw error
    }
  }

  private registerFnStartedBy(
    mapper: WorkflowMapper<any, any>,
    handlerRegistry: HandlerRegistry,
    container: ContainerAdapter | undefined
  ): void {
    this.logger.debug('Registering started by handlers for workflow', {
      numHandlers: mapper.onStartedBy.size
    })
    mapper.onStartedBy.forEach((options, messageConstructor) =>
      handlerRegistry.register(
        messageConstructor,
        async (message, messageAttributes) => {
          this.logger.debug('Starting new workflow instance', {
            workflow: options.workflowCtor,
            msg: message
          })
          const workflowState = this.createWorkflowState(
            mapper.workflowStateCtor!
          )
          const immutableWorkflowState = Object.freeze({ ...workflowState })
          this.startWorkflowHandlingContext(immutableWorkflowState)
          try {
            let workflow: Workflow<WorkflowState>
            if (container) {
              const workflowFromContainer = container.get(
                options.workflowCtor,
                { message, messageAttributes }
              )
              if (workflowFromContainer instanceof Promise) {
                workflow = await workflowFromContainer
              } else {
                workflow = workflowFromContainer
              }
            } else {
              workflow = new options.workflowCtor()
            }
            const handler = workflow[
              options.workflowHandler as keyof Workflow<WorkflowState>
            ] as Function
            const result = await handler.bind(workflow)(
              message,
              immutableWorkflowState,
              messageAttributes
            )

            this.logger.debug('Finished handling for new workflow', {
              workflow: options.workflowCtor,
              msg: message,
              workflowState: result
            })

            if (result) {
              await this.persistence.saveWorkflowState({
                ...workflowState,
                ...result
              })
            }
          } finally {
            this.endWorkflowHandlingContext()
          }
        }
      )
    )
  }

  private registerFnHandles(
    mapper: WorkflowMapper<WorkflowState, Workflow<WorkflowState>>,
    handlerRegistry: HandlerRegistry,
    workflowCtor: ClassConstructor<Workflow<WorkflowState>>,
    container: ContainerAdapter | undefined
  ): void {
    this.logger.debug('Registering handles for workflow', {
      workflow: workflowCtor,
      numHandlers: mapper.onWhen.size
    })

    mapper.onWhen.forEach((handler, messageConstructor) => {
      // TODO implement outbound tagging of workflowId to stickyAttributes
      const messageMapping = handler.customLookup || workflowLookup

      handlerRegistry.register(
        messageConstructor,
        async (message, attributes) => {
          this.logger.debug('Getting workflow state for message handler', {
            msg: message,
            workflow: workflowCtor
          })
          const workflowState = await this.persistence.getWorkflowState<
            WorkflowState,
            Message
          >(
            mapper.workflowStateCtor!,
            messageMapping,
            message,
            attributes,
            false
          )

          if (!workflowState.length) {
            this.logger.info(
              'No existing workflow state found for message. Ignoring.',
              { message }
            )
            return
          }

          const workflowHandlers = workflowState.map(async state => {
            try {
              this.startWorkflowHandlingContext(state)
              await this.dispatchMessageToWorkflow(
                message,
                attributes,
                workflowCtor,
                state,
                mapper.workflowStateCtor!,
                handler.workflowHandler,
                container
              )
            } finally {
              this.endWorkflowHandlingContext()
            }
          })

          const handlerResults = await Promise.allSettled(workflowHandlers)
          const failedHandlers = handlerResults.filter(
            r => r.status === 'rejected'
          )
          if (failedHandlers.length) {
            const reasons = (failedHandlers as PromiseRejectedResult[]).map(
              h => h.reason
            )
            throw new HandlerDispatchRejected(reasons)
          }
        }
      )
    })
  }

  private createWorkflowState<TWorkflowState extends WorkflowState>(
    workflowStateType: ClassConstructor<TWorkflowState>
  ) {
    const data = new workflowStateType()
    data.$status = WorkflowStatus.Running
    data.$workflowId = uuid.v4()
    this.logger.debug('Created new workflow state', {
      workflowId: data.$workflowId,
      workflowStateType
    })
    return data
  }

  /**
   * Creates a new handling context for a single workflow. This is used so
   * that the `$workflowId` is attached to outgoing messages in sticky
   * attributes. This allows message chains to be automatically mapped
   * back to the workflow if handled.
   */
  private async startWorkflowHandlingContext(workflowState: WorkflowState) {
    this.logger.debug('Starting new workflow handling context', {
      workflowState
    })
    const handlingContext = messageHandlingContext.get()!.message
    const workflowHandlingContext = JSON.parse(
      JSON.stringify(handlingContext)
    ) as typeof handlingContext
    workflowHandlingContext.attributes.stickyAttributes.workflowId =
      workflowState.$workflowId
    messageHandlingContext.set(workflowHandlingContext)
  }

  private endWorkflowHandlingContext() {
    this.logger.debug('Ending workflow handling context')
    messageHandlingContext.destroy()
  }

  private async dispatchMessageToWorkflow(
    message: Message,
    attributes: MessageAttributes,
    workflowCtor: ClassConstructor<Workflow<WorkflowState>>,
    workflowState: WorkflowState,
    workflowStateConstructor: ClassConstructor<WorkflowState>,
    workflowHandler: keyof Workflow<WorkflowState>,
    container: ContainerAdapter | undefined
  ) {
    this.logger.debug('Dispatching message to workflow', {
      msg: message,
      workflow: workflowCtor
    })
    let workflow: Workflow<WorkflowState>
    if (container) {
      const workflowFromContainer = container.get(workflowCtor, {
        message,
        messageAttributes: attributes
      })
      if (workflowFromContainer instanceof Promise) {
        workflow = await workflowFromContainer
      } else {
        workflow = workflowFromContainer
      }
    } else {
      workflow = new workflowCtor()
    }

    const immutableWorkflowState = Object.freeze({ ...workflowState })
    const handler = workflow[workflowHandler] as Function
    const workflowStateOutput = await handler.bind(workflow)(
      message,
      immutableWorkflowState,
      attributes
    )

    const workflowName = workflowCtor.prototype.name
    if (
      workflowStateOutput &&
      workflowStateOutput.$status === WorkflowStatus.Discard
    ) {
      this.logger.debug(
        'Workflow step is discarding state changes. State changes will not be persisted',
        { workflowId: immutableWorkflowState.$workflowId, workflowName }
      )
    } else if (workflowStateOutput) {
      this.logger.debug(
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
        await this.persist(updatedWorkflowState)
      } catch (error) {
        this.logger.warn('Error persisting workflow state', {
          err: error,
          workflow: workflowName
        })
        throw error
      }
    } else {
      this.logger.trace('No changes detected in workflow state.', {
        workflowId: immutableWorkflowState.$workflowId
      })
    }
  }

  private async persist(data: WorkflowState) {
    try {
      await this.persistence.saveWorkflowState(data)
      this.logger.info('Workflow state saved', { data })
    } catch (err) {
      this.logger.error('Error persisting workflow state', { err })
      throw err
    }
  }
}
