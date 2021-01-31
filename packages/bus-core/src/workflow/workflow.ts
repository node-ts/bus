import { ClassConstructor } from '../util'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowState, WorkflowStatus } from './workflow-state'
import { WorkflowAlreadyHandlesMessage, WorkflowAlreadyStartedByMessage } from './error'
import { HandlerContext } from '../handler'

export type HandlerReturnType<State> = Promise<Partial<State>>
  | Partial<State>
  | Promise<void>
  | void

export type WorkflowConstructor<
  TWorkflowState extends WorkflowState,
  TWorkflow extends Workflow<TWorkflowState> = Workflow<TWorkflowState>
> = ClassConstructor<TWorkflow>


/**
 * A handler that accepts a message as part of a running workflow
 */
export type WhenHandler<MessageType extends Message, State extends WorkflowState> = (
  parameters: {
    message: MessageType,
    attributes: MessageAttributes,
    state: Readonly<State>
  }
) => HandlerReturnType<State>

interface WhenOptions<MessageType extends Message, State extends WorkflowState> {
  mapsTo: keyof State & string
  // tslint:disable-next-line:prefer-method-signature Avoid unbound this
  lookup: (context: HandlerContext<MessageType>) => string | undefined
}

export const completeWorkflow = <State>(state?: Partial<State>): Partial<State> => {
  return {
    ...state,
    $status: WorkflowStatus.Complete
  } as {} as Partial<State> // TODO naughty
}

export interface OnWhenHandler {
  handler: WhenHandler<Message, WorkflowState>
  options: WhenOptions<Message, WorkflowState>
}

export class Workflow <State extends WorkflowState = WorkflowState> {

  readonly state: State & WorkflowState
  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    WhenHandler<Message, State & WorkflowState>
  >()
  readonly onWhen = new Map<ClassConstructor<Message>, OnWhenHandler>()

  private constructor (
    readonly workflowName: string,
    readonly stateType: ClassConstructor<State>
  ) {
  }

  static configure<TWorkflowState extends WorkflowState> (name: string, workflowStateType: ClassConstructor<TWorkflowState>) {
    return new Workflow<TWorkflowState>(name, workflowStateType)
  }

  /**
   * Declare which message will start a new instance of the workflow running.
   * @param message The message type that will start a new workflow instance
   * @param handler A message handler that will be passed the message after the workflow starts
   */
  startedBy<MessageType extends Message>  (
    message: ClassConstructor<MessageType>,
    handler: WhenHandler<MessageType, State & WorkflowState>
  ): this {
    if (this.onStartedBy.has(message)) {
      throw new WorkflowAlreadyStartedByMessage(this.workflowName, message)
    }
    this.onStartedBy.set(message, handler)
    return this
  }

  when<MessageType extends Message> (
    message: ClassConstructor<MessageType>,
    options: WhenOptions<MessageType, State & WorkflowState>,
    handler: WhenHandler<MessageType, State & WorkflowState>
  ): this {
    if (this.onWhen.has(message)) {
      throw new WorkflowAlreadyHandlesMessage(this.workflowName, message)
    }

    this.onWhen.set(
      message,
      {
        handler,
        options: options as WhenOptions<MessageType, WorkflowState>
      }
    )
    return this
  }
}
