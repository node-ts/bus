import { ClassConstructor } from '../util'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowStatus } from './workflow-data'
import { WorkflowAlreadyHandlesMessage, WorkflowAlreadyStartedByMessage } from './error'

export type HandlerReturnType<State> = Promise<Partial<State>>
  | Partial<State>
  | Promise<void>
  | void

export type WorkflowConstructor<
  TWorkflowData extends WorkflowData,
  TWorkflow extends Workflow<TWorkflowData> = Workflow<TWorkflowData>
> = ClassConstructor<TWorkflow>


export type WhenHandler<MessageType extends Message, State extends WorkflowData> = (
  parameters: {
    message: MessageType,
    messageAttributes: MessageAttributes,
    workflowState: Readonly<State>
  }
) => HandlerReturnType<State>

interface WhenOptions<MessageType extends Message, State extends WorkflowData> {
  mapsTo: keyof State & string
  // tslint:disable-next-line:prefer-method-signature Avoid unbound this
  lookup: (message: MessageType, attributes: MessageAttributes) => string | undefined
}

export const completeWorkflow = <State>(state?: Partial<State>): Partial<State> => {
  return {
    ...state,
    $status: WorkflowStatus.Complete
  } as {} as Partial<State> // TODO naughty
}

export interface OnWhenHandler {
  handler: WhenHandler<Message, WorkflowData>
  options: WhenOptions<Message, WorkflowData>
}

export class Workflow <State extends WorkflowData = WorkflowData> {

  readonly state: State & WorkflowData
  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    WhenHandler<Message, State & WorkflowData>
  >()
  readonly onWhen = new Map<ClassConstructor<Message>, OnWhenHandler>()

  private constructor (
    readonly workflowName: string,
    readonly stateType: ClassConstructor<State>
  ) {
  }

  static configure<TWorkflowData extends WorkflowData> (name: string, workflowStateType: ClassConstructor<TWorkflowData>) {
    return new Workflow<TWorkflowData>(name, workflowStateType)
  }

  /**
   * Declare which message will start a new instance of the workflow running.
   * @param message The message type that will start a new workflow instance
   * @param handler A message handler that will be passed the message after the workflow starts
   */
  startedBy<MessageType extends Message>  (
    message: ClassConstructor<MessageType>,
    handler: WhenHandler<MessageType, State & WorkflowData>
  ): this {
    if (this.onStartedBy.has(message)) {
      throw new WorkflowAlreadyStartedByMessage(this.workflowName, message)
    }
    this.onStartedBy.set(message, handler)
    return this
  }

  when<MessageType extends Message> (
    message: ClassConstructor<MessageType>,
    options: WhenOptions<MessageType, State & WorkflowData>,
    handler: WhenHandler<MessageType, State & WorkflowData>
  ): this {
    if (this.onWhen.has(message)) {
      throw new WorkflowAlreadyHandlesMessage(this.workflowName, message)
    }

    this.onWhen.set(
      message,
      {
        handler,
        options: options as WhenOptions<MessageType, WorkflowData>
      }
    )
    return this
  }
}
