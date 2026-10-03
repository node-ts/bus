import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { ContainerAdapter } from '../../container'
import {
  FunctionHandler,
  HandlerContext,
  HandlerDispatchRejected,
  HandlerRegistry
} from '../../handler'
import { Logger } from '../../logger'
import { MessageHandlingContext } from '../../message-handling-context'
import { MessageLifecycleContext } from '../../message-lifecycle-context'
import { TransportMessage } from '../../transport'
import { ClassConstructor, CoreDependencies } from '../../util'
import { FunctionWorkflow } from '../define-workflow'
import {
  WorkflowAlreadyInitialized,
  WorkflowHandlerFailed,
  WorkflowNameAlreadyRegistered,
  WorkflowNotRecognized,
  WorkflowRegisteredAfterInitialization,
  WorkflowStateNotProvided
} from '../error'
import {
  FunctionWorkflowDefinition,
  FunctionWorkflowHandler,
  isFunctionWorkflow
} from '../function-workflow-definition'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Persistence } from '../persistence'
import { PersistenceNotConfigured } from '../persistence/error'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowContext } from '../workflow-context'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { WorkflowHandlerResult } from '../workflow-state-change'
import { WorkflowHandlerFn } from './workflow-handler-fn'

/**
 * A default lookup that will match a workflow by its id with the workflowId
 * stored in the sticky attributes
 */
const workflowLookup: MessageWorkflowMapping = {
  lookup: (
    _: Message,
    attributes: MessageAttributes<{}, { workflowId: string | undefined }>
  ) => attributes.stickyAttributes.workflowId,
  mapsTo: '$workflowId'
}

/**
 * How many buses use each persistence instance, so a persistence shared by several buses is only disposed by the
 * last of them. This holds no message or workflow state, and drops persistences that are garbage collected.
 */
const PERSISTENCE_USERS = new WeakMap<Persistence, number>()

/**
 * A class workflow, or a workflow declared with `defineWorkflow`, as `withWorkflow()` takes it
 */
type WorkflowToRegister =
  ClassConstructor<Workflow<WorkflowState>> | FunctionWorkflow<WorkflowState>

/**
 * A class workflow, or a workflow declared with `defineWorkflow` with the handlers it holds
 */
type RegisteredWorkflow =
  | ClassConstructor<Workflow<WorkflowState>>
  | FunctionWorkflowDefinition<WorkflowState>

/**
 * Calls one workflow handler for a message, whichever way the workflow was declared
 */
type WorkflowHandlerInvoker = (
  message: Message,
  workflowState: Readonly<WorkflowState>,
  attributes: MessageAttributes,
  context: HandlerContext
) => Promise<WorkflowHandlerResult<WorkflowState>>

/**
 * A workflow's handlers, in the same shape for class workflows and workflows declared with `defineWorkflow`
 */
interface WorkflowHandlers {
  workflowName: string
  workflowStateType: ClassConstructor<WorkflowState>
  startedBy: Map<MessageDeclaration<Message>, WorkflowHandlerInvoker>
  when: Map<
    MessageDeclaration<Message>,
    {
      invoke: WorkflowHandlerInvoker
      customLookup: MessageWorkflowMapping | undefined
    }
  >
}

const workflowNameOf = (workflow: RegisteredWorkflow): string =>
  isFunctionWorkflow(workflow)
    ? workflow.name
    : workflow.prototype.constructor.name

/**
 * The central workflow registry that holds all workflows managed by the application. This includes
 *   - the list of workflows
 *   - what messages start the workflow
 *   - what messages are handled by each workflow
 * This registry is also responsible for dispatching messages to workflows as they are received.
 */
export class WorkflowRegistry {
  private workflowRegistry: RegisteredWorkflow[] = []
  private workflowStateNames: string[] = []
  private isInitialized = false
  private isInitializing = false
  private logger: Logger
  private persistence: Persistence
  private coreDependencies: CoreDependencies
  private messageHandlingContext: MessageHandlingContext
  private messageLifecycleContext: MessageLifecycleContext

  /**
   * @param coreDependencies the dependencies of the bus the registry belongs to
   * @param persistence where workflow state is stored, which may be shared with other buses
   * @param messageHandlingContext the handling context of the bus the registry belongs to
   * @param messageLifecycleContext the lifecycle context of the bus, which says if a handler failed or returned the
   * message
   */
  prepare(
    coreDependencies: CoreDependencies,
    persistence: Persistence,
    messageHandlingContext: MessageHandlingContext,
    messageLifecycleContext: MessageLifecycleContext
  ): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:workflow-registry'
    )
    this.coreDependencies = coreDependencies
    this.persistence = persistence
    this.messageHandlingContext = messageHandlingContext
    this.messageLifecycleContext = messageLifecycleContext
    PERSISTENCE_USERS.set(
      persistence,
      (PERSISTENCE_USERS.get(persistence) ?? 0) + 1
    )
  }

  /**
   * Registers a workflow to be initialized with the bus
   * @param workflowToRegister a class that extends `Workflow`, or a workflow declared with `defineWorkflow`
   * @throws WorkflowNotRecognized if it's neither
   * @throws WorkflowRegisteredAfterInitialization if workflows have already been initialized
   * @throws WorkflowNameAlreadyRegistered if a workflow with the same name is already registered
   */
  register(workflowToRegister: WorkflowToRegister): void {
    if (
      typeof workflowToRegister !== 'function' &&
      !isFunctionWorkflow(workflowToRegister)
    ) {
      throw new WorkflowNotRecognized(workflowToRegister)
    }
    const workflow: RegisteredWorkflow = workflowToRegister
    const workflowName = workflowNameOf(workflow)
    if (this.isInitialized) {
      throw new WorkflowRegisteredAfterInitialization(workflowName)
    }

    const duplicateWorkflowName = this.workflowRegistry.some(
      r => workflowNameOf(r) === workflowName
    )

    if (duplicateWorkflowName) {
      throw new WorkflowNameAlreadyRegistered(workflowName)
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
      this.logger.info(
        'No workflows registered, skipping workflow initialization.'
      )
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

    for (const workflow of this.workflowRegistry) {
      this.logger.debug('Initializing workflow', {
        workflow: workflowNameOf(workflow)
      })

      const workflowHandlers = isFunctionWorkflow(workflow)
        ? this.getFunctionWorkflowHandlers(workflow)
        : await this.getClassWorkflowHandlers(workflow, container)

      this.workflowStateNames.push(
        new workflowHandlers.workflowStateType().$name
      )

      this.registerFnStartedBy(workflowHandlers, handlerRegistry)
      this.registerFnHandles(workflowHandlers, handlerRegistry)

      const messageWorkflowMappings: MessageWorkflowMapping[] = Array.from(
        workflowHandlers.when.values(),
        ({ customLookup }) => customLookup || workflowLookup
      )
      await this.persistence.initializeWorkflow(
        workflowHandlers.workflowStateType,
        messageWorkflowMappings
      )
      this.logger.debug('Workflow initialized', {
        workflowName: workflowHandlers.workflowName
      })
    }

    this.workflowRegistry = []

    this.isInitialized = true
    this.isInitializing = false
    this.logger.info('Workflows initialized')
  }

  /**
   * Gets the `$name` of the state of every workflow that's been initialized
   * @returns the workflow state names
   */
  getWorkflowStateNames(): string[] {
    return [...this.workflowStateNames]
  }

  async dispose(): Promise<void> {
    const isPrepared = this.persistence !== undefined
    if (!isPrepared) {
      // If the registry has not been prepared, then there is no logger or persistence available
      return
    }

    this.logger.debug('Disposing workflow registry')
    const remainingUsers = (PERSISTENCE_USERS.get(this.persistence) ?? 1) - 1
    PERSISTENCE_USERS.set(this.persistence, remainingUsers)
    if (remainingUsers > 0) {
      this.logger.debug(
        'Persistence is still used by another bus, so it will not be disposed',
        { remainingUsers }
      )
      return
    }
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

  /**
   * Reads the handlers of a class workflow by calling its `configureWorkflow`. The workflow is resolved from the
   * container, or constructed with no arguments, each time it handles a message.
   */
  private async getClassWorkflowHandlers(
    WorkflowCtor: ClassConstructor<Workflow<WorkflowState>>,
    container: ContainerAdapter | undefined
  ): Promise<WorkflowHandlers> {
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
      throw new WorkflowStateNotProvided(
        WorkflowCtor.prototype.constructor.name
      )
    }

    const invokerFor =
      (
        workflowHandler: keyof Workflow<WorkflowState>
      ): WorkflowHandlerInvoker =>
      async (message, workflowState, attributes, context) => {
        let workflow: Workflow<WorkflowState>
        if (container) {
          const workflowFromContainer = container.get(WorkflowCtor, {
            message,
            messageAttributes: attributes
          })
          if (workflowFromContainer instanceof Promise) {
            workflow = await workflowFromContainer
          } else {
            workflow = workflowFromContainer
          }
        } else {
          workflow = new WorkflowCtor()
        }

        const handler = workflow[
          workflowHandler
        ] as unknown as WorkflowHandlerFn<Message, WorkflowState>
        return handler.bind(workflow)(
          message,
          workflowState,
          attributes,
          context
        )
      }

    return {
      workflowName: WorkflowCtor.name,
      workflowStateType: mapper.workflowStateCtor,
      startedBy: new Map(
        Array.from(mapper.onStartedBy, ([messageType, options]) => [
          messageType,
          invokerFor(options.workflowHandler as keyof Workflow<WorkflowState>)
        ])
      ),
      when: new Map(
        Array.from(mapper.onWhen, ([messageType, options]) => [
          messageType,
          {
            invoke: invokerFor(
              options.workflowHandler as keyof Workflow<WorkflowState>
            ),
            customLookup: options.customLookup
          }
        ])
      )
    }
  }

  /**
   * Reads the handlers of a workflow declared with `defineWorkflow`, and passes each a `WorkflowContext`
   */
  private getFunctionWorkflowHandlers(
    workflow: FunctionWorkflowDefinition<WorkflowState>
  ): WorkflowHandlers {
    const invokerFor =
      (
        handler: FunctionWorkflowHandler<WorkflowState>
      ): WorkflowHandlerInvoker =>
      async (message, workflowState, attributes, context) => {
        const workflowContext: WorkflowContext<WorkflowState> = {
          correlationId: context.correlationId,
          send: context.send.bind(context),
          publish: context.publish.bind(context),
          failMessage: context.failMessage.bind(context),
          returnMessage: context.returnMessage.bind(context),
          attributes,
          complete: workflowStateChange => ({
            ...workflowStateChange,
            $status: WorkflowStatus.Complete
          }),
          discard: () => ({ $status: WorkflowStatus.Discard })
        }
        return handler.handle(
          message,
          workflowState,
          Object.freeze(workflowContext)
        )
      }

    return {
      workflowName: workflow.name,
      workflowStateType: workflow.workflowStateType,
      startedBy: new Map(
        workflow.startedByHandlers.map(handler => [
          handler.messageType,
          invokerFor(handler)
        ])
      ),
      when: new Map(
        workflow.whenHandlers.map(handler => [
          handler.messageType,
          { invoke: invokerFor(handler), customLookup: handler.customLookup }
        ])
      )
    }
  }

  private registerFnStartedBy(
    workflowHandlers: WorkflowHandlers,
    handlerRegistry: HandlerRegistry
  ): void {
    const { workflowName, workflowStateType } = workflowHandlers
    this.logger.debug('Registering started by handlers for workflow', {
      workflowName,
      numHandlers: workflowHandlers.startedBy.size
    })
    workflowHandlers.startedBy.forEach((invoke, messageConstructor) =>
      this.registerWorkflowHandler(
        handlerRegistry,
        workflowName,
        messageConstructor,
        async (message, messageAttributes, context) => {
          this.logger.debug('Starting new workflow instance', {
            workflowName,
            msg: message
          })
          await this.dispatchMessageToWorkflowInstance(
            message,
            messageAttributes,
            workflowName,
            this.createWorkflowState(workflowStateType),
            workflowStateType,
            invoke,
            context
          )
        }
      )
    )
  }

  private registerFnHandles(
    workflowHandlers: WorkflowHandlers,
    handlerRegistry: HandlerRegistry
  ): void {
    const { workflowName, workflowStateType } = workflowHandlers
    this.logger.debug('Registering handles for workflow', {
      workflowName,
      numHandlers: workflowHandlers.when.size
    })

    workflowHandlers.when.forEach((handler, messageConstructor) => {
      const messageMapping = handler.customLookup || workflowLookup

      this.registerWorkflowHandler(
        handlerRegistry,
        workflowName,
        messageConstructor,
        async (message, attributes, context) => {
          this.logger.debug('Getting workflow state for message handler', {
            msg: message,
            workflowName
          })
          const storedWorkflowState = await this.persistence.getWorkflowState<
            WorkflowState,
            Message
          >(workflowStateType, messageMapping, message, attributes, false)
          const workflowState = storedWorkflowState.map(state =>
            this.toWorkflowState(state, workflowStateType)
          )

          if (!workflowState.length) {
            this.logger.error(
              'No existing workflow state found for message. Ignoring.',
              { busMessage: message, attributes }
            )
            return
          }

          const workflowHandlers = workflowState.map(state =>
            this.dispatchMessageToWorkflowInstance(
              message,
              attributes,
              workflowName,
              state,
              workflowStateType,
              handler.invoke,
              context
            )
          )

          const handlerResults = await Promise.allSettled(workflowHandlers)
          const reasons = handlerResults
            .filter(r => r.status === 'rejected')
            .map(r => (r as PromiseRejectedResult).reason as Error)
          if (reasons.length === 1) {
            // Already names the workflow, and the bus lists it with the message's other handler failures
            throw reasons[0]
          }
          if (reasons.length) {
            throw new HandlerDispatchRejected(reasons)
          }
        }
      )
    })
  }

  /**
   * Registers a handler for a workflow, named after the workflow so that handler middleware gets it as `handlerName`
   */
  private registerWorkflowHandler(
    handlerRegistry: HandlerRegistry,
    workflowName: string,
    messageType: MessageDeclaration<Message>,
    handler: FunctionHandler<Message>
  ): void {
    handlerRegistry.register(
      messageType,
      Object.defineProperty(handler, 'name', { value: workflowName })
    )
  }

  private createWorkflowState<TWorkflowState extends WorkflowState>(
    workflowStateType: ClassConstructor<TWorkflowState>
  ) {
    const data = new workflowStateType()
    data.$version = 0
    data.$status = WorkflowStatus.Running
    data.$workflowId = randomUUID()
    this.logger.debug('Created new workflow state', {
      workflowId: data.$workflowId,
      workflowStateType
    })
    return data
  }

  /**
   * Creates a new handling context for a single workflow. This is used so
   * that the `workflowId` is attached to outgoing messages in sticky
   * attributes. This allows message chains to be automatically mapped
   * back to the workflow if handled.
   */
  private buildWorkflowHandlingContext(
    workflowState: WorkflowState
  ): TransportMessage<unknown> {
    this.logger.debug('Starting new workflow handling context', {
      workflowState
    })
    const handlingContext = this.messageHandlingContext.get()!
    // Copy only what changes. A deep clone would throw on a transport `raw` message that can't be cloned.
    return {
      ...handlingContext,
      attributes: {
        ...handlingContext.attributes,
        stickyAttributes: {
          ...handlingContext.attributes.stickyAttributes,
          workflowId: workflowState.$workflowId
        }
      }
    }
  }

  /**
   * Runs a workflow handler for one workflow instance in a handling context of its own
   * @throws WorkflowHandlerFailed if the handler throws or the state it returns can't be saved
   */
  private async dispatchMessageToWorkflowInstance(
    message: Message,
    attributes: MessageAttributes,
    workflowName: string,
    workflowState: WorkflowState,
    workflowStateConstructor: ClassConstructor<WorkflowState>,
    invoke: WorkflowHandlerInvoker,
    context: HandlerContext
  ): Promise<void> {
    const immutableWorkflowState = Object.freeze({ ...workflowState })
    // Extend the current message handling context, and augment with workflow-specific context data
    const workflowContext = this.buildWorkflowHandlingContext(
      immutableWorkflowState
    )
    try {
      await this.messageHandlingContext.run(
        workflowContext,
        async () => {
          await this.dispatchMessageToWorkflow(
            message,
            attributes,
            workflowName,
            immutableWorkflowState,
            workflowStateConstructor,
            invoke,
            context
          )
        },
        true
      )
    } catch (error) {
      throw new WorkflowHandlerFailed(
        workflowName,
        immutableWorkflowState.$workflowId,
        message.$name,
        error
      )
    }
  }

  private async dispatchMessageToWorkflow(
    message: Message,
    attributes: MessageAttributes,
    workflowName: string,
    immutableWorkflowState: WorkflowState,
    workflowStateConstructor: ClassConstructor<WorkflowState>,
    invoke: WorkflowHandlerInvoker,
    context: HandlerContext
  ) {
    this.logger.debug('Dispatching message to workflow', {
      msg: message,
      workflowName
    })

    const workflowStateOutput = await invoke(
      message,
      immutableWorkflowState,
      attributes,
      context
    )

    if (this.messageLifecycleContext.isFailedOrReturned()) {
      // The message will be dead-lettered or handled again, so saving the state would get ahead of it
      this.logger.debug(
        'Message was failed or returned, so the workflow state changes will not be persisted',
        { workflowId: immutableWorkflowState.$workflowId, workflowName }
      )
    } else if (
      workflowStateOutput &&
      workflowStateOutput.$status === WorkflowStatus.Discard
    ) {
      this.logger.debug(
        'Workflow step is discarding state changes. State changes will not be persisted',
        { workflowId: immutableWorkflowState.$workflowId, workflowName }
      )
    } else if (workflowStateOutput || immutableWorkflowState.$version === 0) {
      // Persist the original workflow state if nothing's returned from the workflow startedBy function
      const workflowStateToChange =
        workflowStateOutput ?? immutableWorkflowState
      this.logger.debug(
        'Changes detected in workflow state and will be persisted.',
        {
          workflowId: immutableWorkflowState.$workflowId,
          workflowName,
          changes: workflowStateToChange
        }
      )

      const updatedWorkflowState = Object.assign(
        new workflowStateConstructor(),
        immutableWorkflowState,
        workflowStateToChange,
        // Managed by the bus, so a handler that returns a copy of the state, or other values, can't change them
        {
          $workflowId: immutableWorkflowState.$workflowId,
          $version: immutableWorkflowState.$version,
          $name: immutableWorkflowState.$name
        }
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
      this.logger.debug('No changes detected in workflow state.', {
        workflowId: immutableWorkflowState.$workflowId
      })
    }
  }

  /**
   * Restores workflow state read from the persistence with this bus' serializer and message types, so a
   * persistence shared with other buses doesn't need either
   */
  private toWorkflowState(
    storedWorkflowState: WorkflowState,
    workflowStateConstructor: ClassConstructor<WorkflowState>
  ): WorkflowState {
    return this.coreDependencies.serializer.toClass(
      storedWorkflowState,
      workflowStateConstructor,
      this.coreDependencies.messageTypes
    )
  }

  private async persist(data: WorkflowState) {
    try {
      // The persistence stores plain JSON values, so it doesn't need this bus' serializer
      await this.persistence.saveWorkflowState(
        this.coreDependencies.serializer.toPlain(data) as WorkflowState
      )
      this.logger.debug('Workflow state saved', { data })
    } catch (err) {
      this.logger.error('Error persisting workflow state', { err })
      throw err
    }
  }
}
