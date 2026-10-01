import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { ClassConstructor } from '../util'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage
} from './error'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from './workflow-state'

/**
 * A workflow handler function. Parameters are in the order the workflow registry invokes them with.
 * @param message The message that was received
 * @param workflowState The current, read-only state of the workflow instance
 * @param attributes Attributes of the message that was received
 * @param context Sends, publishes, fails or returns messages through the bus that received the message. Messages
 * sent from it carry the workflow id, so replies are routed back to this workflow instance.
 * @returns Changes to the workflow state to persist, or nothing to leave it unchanged
 * @example
 * async start(message: OrderPlaced, _state: OrderState, _attributes: MessageAttributes, ctx: HandlerContext) {
 *   await ctx.send(new ChargeCard(message.orderId))
 *   return { orderId: message.orderId }
 * }
 */
export type WorkflowHandler<
  TMessage extends Message,
  TMessageAttributes extends MessageAttributes,
  WorkflowStateType extends WorkflowState
> = (
  message?: TMessage,
  workflowState?: Readonly<WorkflowStateType>,
  attributes?: TMessageAttributes,
  context?: HandlerContext
) =>
  void | Partial<WorkflowStateType> | Promise<void | Partial<WorkflowStateType>>

export type WhenHandler<
  WorkflowStateType extends WorkflowState,
  WorkflowType extends Workflow<WorkflowStateType>
> = (
  workflow: WorkflowType
) => WorkflowHandler<Message, MessageAttributes, WorkflowStateType>

type KeyOfType<T, U> = { [P in keyof T]: T[P] extends U ? P : never }[keyof T]
type AnyFunction = (...args: any[]) => any

export type OnWhenHandler<
  WorkflowStateType extends WorkflowState = WorkflowState,
  WorkflowType extends Workflow<WorkflowStateType> = Workflow<WorkflowStateType>
> = {
  workflowCtor: ClassConstructor<Workflow<WorkflowState>>
  workflowHandler: KeyOfType<WorkflowType, AnyFunction>
  customLookup: MessageWorkflowMapping | undefined
}

/**
 * A workflow configuration that describes how to map incoming messages to handlers within the workflow.
 */
export class WorkflowMapper<
  WorkflowStateType extends WorkflowState,
  WorkflowType extends Workflow<WorkflowStateType>
> {
  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    {
      workflowCtor: ClassConstructor<Workflow<WorkflowState>>
      workflowHandler: KeyOfType<WorkflowType, AnyFunction>
    }
  >()
  readonly onWhen = new Map<
    ClassConstructor<Message>,
    OnWhenHandler<WorkflowStateType, WorkflowType>
  >()
  private workflowStateType: ClassConstructor<WorkflowStateType> | undefined

  constructor(
    private readonly workflow: ClassConstructor<Workflow<WorkflowState>>
  ) {}

  get workflowStateCtor(): ClassConstructor<WorkflowStateType> | undefined {
    return this.workflowStateType
  }

  withState(workflowStateType: ClassConstructor<WorkflowStateType>): this {
    this.workflowStateType = workflowStateType
    return this
  }

  /**
   * Starts a new instance of the workflow each time `message` is handled.
   *
   * Messages are delivered at least once and starts aren't deduplicated, so a `message` that's retried after the
   * new workflow state was saved (for example because another handler of the same message failed) starts a second
   * workflow instance. Make the handler idempotent, such as by returning `discardWorkflow()` when a workflow already
   * exists for the message, if that matters.
   * @param message The message that starts the workflow
   * @param workflowHandler The name of the workflow method that handles `message`
   * @throws WorkflowAlreadyStartedByMessage if the workflow is already started by `message`
   */
  startedBy<MessageType extends Message>(
    message: ClassConstructor<MessageType>,
    workflowHandler: KeyOfType<WorkflowType, AnyFunction>
  ): this {
    if (this.onStartedBy.has(message)) {
      throw new WorkflowAlreadyStartedByMessage(this.workflow.name, message)
    }
    this.onStartedBy.set(message, {
      workflowHandler,
      workflowCtor: this.workflow
    })
    return this
  }

  when<MessageType extends Message>(
    message: ClassConstructor<MessageType>,
    workflowHandler: KeyOfType<WorkflowType, AnyFunction>,
    customLookup?: MessageWorkflowMapping<MessageType, WorkflowStateType>
  ): this {
    if (this.onWhen.has(message)) {
      throw new WorkflowAlreadyHandlesMessage(this.workflow.name, message)
    }
    this.onWhen.set(message, {
      workflowHandler,
      workflowCtor: this.workflow,
      customLookup: customLookup as MessageWorkflowMapping<
        Message,
        WorkflowState
      >
    })
    return this
  }
}

export abstract class Workflow<WorkflowStateType extends WorkflowState> {
  abstract configureWorkflow(
    mapper: WorkflowMapper<WorkflowStateType, any>
  ): void

  /**
   * Ends the workflow and optionally sets any final state. After this is returned,
   * the workflow instance will no longer be activated for subsequent messages.
   */
  protected completeWorkflow(workflowState?: Partial<WorkflowStateType>) {
    return {
      ...workflowState,
      $status: WorkflowStatus.Complete
    }
  }

  /**
   * Prevents a new workflow from starting, and prevents the persistence of
   * the workflow state. This should only be used in `startedBy` workflow handlers.
   */
  protected discardWorkflow() {
    return { $status: WorkflowStatus.Discard }
  }
}
