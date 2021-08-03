import { Message } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { ClassConstructor } from '../util'
import { WorkflowAlreadyHandlesMessage, WorkflowAlreadyStartedByMessage } from './error'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from './workflow-state'

export type WorkflowHandler<TMessage extends Message, WorkflowStateType extends WorkflowState> =
  (context?: HandlerContext<TMessage>, workflowState?: WorkflowStateType) => void | Partial<WorkflowStateType> | Promise<void | Partial<WorkflowStateType>>

export type WhenHandler<WorkflowStateType extends WorkflowState, WorkflowType extends Workflow<WorkflowStateType>> =
  (workflow: WorkflowType) => WorkflowHandler<Message, WorkflowStateType>

type KeyOfType<T, U> = {[P in keyof T]: T[P] extends U ? P: never}[keyof T]

export type OnWhenHandler<WorkflowStateType extends WorkflowState = WorkflowState, WorkflowType extends Workflow<WorkflowStateType> = Workflow<WorkflowStateType>> = {
  workflowCtor: ClassConstructor<Workflow<WorkflowState>>
  workflowHandler: KeyOfType<WorkflowType, Function>
  customLookup: MessageWorkflowMapping | undefined
}

/**
 * A workflow configuration that describes how to map incoming messages to handlers within the workflow.
 */
export class WorkflowMapper<WorkflowStateType extends WorkflowState, WorkflowType extends Workflow<WorkflowStateType>> {

  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    {
      workflowCtor: ClassConstructor<Workflow<WorkflowState>>
      workflowHandler: KeyOfType<WorkflowType, Function>
    }
  >()
  readonly onWhen = new Map<
    ClassConstructor<Message>,
    OnWhenHandler<WorkflowStateType, WorkflowType>
  >()
  private workflowStateType: ClassConstructor<WorkflowStateType> | undefined

  constructor (
    private readonly workflow: ClassConstructor<Workflow<WorkflowState>>
  ) {
  }

  get workflowStateCtor (): ClassConstructor<WorkflowStateType> | undefined {
    return this.workflowStateType
  }

  withState (workflowStateType: ClassConstructor<WorkflowStateType>): this {
    this.workflowStateType = workflowStateType
    return this
  }

  startedBy<MessageType extends Message>(
    message: ClassConstructor<MessageType>,
    workflowHandler: KeyOfType<WorkflowType, Function>
    // workflowHandler: (workflow: WorkflowType) => WorkflowHandler<MessageType, WorkflowStateType>
  ): this {
    if (this.onStartedBy.has(message)) {
      throw new WorkflowAlreadyStartedByMessage(this.workflow.name, message)
    }
    this.onStartedBy.set(
      message,
      {
        workflowHandler,
        workflowCtor: this.workflow
      }
    )
    return this
  }

  when<MessageType extends Message>(
    message: ClassConstructor<MessageType>,
    workflowHandler: KeyOfType<WorkflowType, Function>,
    customLookup?: MessageWorkflowMapping<MessageType, WorkflowStateType>
  ): this {
    if (this.onWhen.has(message)) {
      throw new WorkflowAlreadyHandlesMessage(this.workflow.name, message)
    }
    this.onWhen.set(message, {
      workflowHandler,
      workflowCtor: this.workflow,
      customLookup: customLookup as MessageWorkflowMapping<Message, WorkflowState>
    })
    return this
  }
}

export abstract class Workflow<WorkflowStateType extends WorkflowState> {
  abstract configureWorkflow (mapper: WorkflowMapper<WorkflowStateType, any>): void

  /**
   * Ends the workflow and optionally sets any final state. After this is returned,
   * the workflow instance will no longer be activated for subsequent messages.
   */
  protected completeWorkflow (workflowState?: Partial<WorkflowStateType>) {
    return {
      ...workflowState,
      $status: WorkflowStatus.Complete
    }
  }

  /**
   * Prevents a new workflow from starting, and prevents the persistence of
   * the workflow state. This should only be used in `startedBy` workflow handlers.
   */
  protected discardWorkflow () {
    return { $status: WorkflowStatus.Discard }
  }
}
