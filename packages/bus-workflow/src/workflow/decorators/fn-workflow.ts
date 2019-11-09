import { ClassConstructor } from '@node-ts/bus-core'
import { Message } from '@node-ts/bus-messages'
import { interfaces } from 'inversify'
import { WorkflowStatus } from '../workflow-data'
import { MessageWorkflowMapping } from '../message-workflow-mapping'

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

export type WhenHandler<MessageType extends Message, State extends WorkflowState, Dependenices> = (
  parameters: {
    message: MessageType,
    state: Readonly<State>
    dependencies: Dependenices
  }
) => HandlerReturnType<State>

interface WhenOptions<MessageType extends Message, State extends WorkflowState> {
  mapping: keyof State & string
  lookup (message: MessageType): string | undefined
}

export const completeWorkflow = <State>(state?: Partial<State>): Partial<State> => {
  return {
    ...state,
    $status: WorkflowStatus.Complete
  } as {} as Partial<State> // TODO naughty
}

export type OnWhenHandler = {
  handler: WhenHandler<Message, WorkflowState, {}>
  options: WhenOptions<Message, WorkflowState>
}

export class FnWorkflow <State, Dependencies extends object = {}> {

  readonly state: State & WorkflowState
  readonly onStartedBy = new Map<
    ClassConstructor<Message>,
    WhenHandler<Message, State & WorkflowState, Dependencies> | undefined
  >()
  readonly onWhen = new Map<ClassConstructor<Message>, OnWhenHandler>()

  constructor (
    readonly workflowName: string,
    readonly dependencyResolver?: (container: interfaces.Container) => Dependencies
  ) {
  }

  startedBy<MessageType extends Message>  (
    message: ClassConstructor<MessageType>,
    handler?: WhenHandler<MessageType, State & WorkflowState, Dependencies>
  ): this {
    // TODO warn when already handled
    this.onStartedBy.set(message, handler)
    return this
  }

  when<MessageType extends Message> (
    message: ClassConstructor<MessageType>,
    handler: WhenHandler<MessageType, State & WorkflowState, Dependencies>,
    options: WhenOptions<MessageType, State & WorkflowState>
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
