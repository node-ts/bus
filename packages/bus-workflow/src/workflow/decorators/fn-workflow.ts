import { ClassConstructor } from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowStatus } from '../workflow-data'

export interface WorkflowState {
  $workflowId: string
  $name: string
  $status: WorkflowStatus
  $version: number
}

export type HandlerReturnType<State> = Promise<Partial<State>>
  | Partial<State>
  | Promise<void>
  | void

export type WhenHandler<MessageType extends Message, State extends WorkflowState> = (
  parameters: {
    message: MessageType,
    messageAttributes: MessageAttributes,
    state: Readonly<State>
  }
) => HandlerReturnType<State>

interface WhenOptions<MessageType extends Message, State extends WorkflowState> {
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
  handler: WhenHandler<Message, WorkflowState>
  options: WhenOptions<Message, WorkflowState>
}

export class FnWorkflow <State> {

  readonly state: State & WorkflowState
  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    WhenHandler<Message, State & WorkflowState> | undefined
  >()
  readonly onWhen = new Map<ClassConstructor<Message>, OnWhenHandler>()

  constructor (
    readonly workflowName: string
  ) {
  }

  startedBy<MessageType extends Message>  (
    message: ClassConstructor<MessageType>,
    handler?: WhenHandler<MessageType, State & WorkflowState>
  ): this {
    // TODO warn when already handled
    this.onStartedBy.set(message, handler)
    return this
  }

  when<MessageType extends Message> (
    message: ClassConstructor<MessageType>,
    options: WhenOptions<MessageType, State & WorkflowState>,
    handler: WhenHandler<MessageType, State & WorkflowState>
  ): this {
    // TODO warn when already handled
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
