import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { ClassConstructor } from '../util'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage,
  WorkflowMappingInvalid
} from './error'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowState, WorkflowStatus } from './workflow-state'
import {
  CheckedWorkflowHandler,
  WorkflowHandlerResult,
  WorkflowStateChange
} from './workflow-state-change'

/**
 * A handler method of a class workflow. Parameters are in the order the workflow registry invokes them with. A
 * method may declare fewer of them, such as only the message.
 * @param message The message that was received
 * @param workflowState The current, read-only state of the workflow instance. In a `startedBy` handler it's the new
 * state, with only `$workflowId`, `$status` and `$version` set.
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
  message: TMessage,
  workflowState: Readonly<WorkflowStateType>,
  attributes: TMessageAttributes,
  context: HandlerContext
) =>
  | WorkflowHandlerResult<WorkflowStateType>
  | Promise<WorkflowHandlerResult<WorkflowStateType>>

export type WhenHandler<
  WorkflowStateType extends WorkflowState,
  WorkflowType extends Workflow<WorkflowStateType>
> = (
  workflow: WorkflowType
) => WorkflowHandler<Message, MessageAttributes, WorkflowStateType>

/**
 * The names of the public methods of a workflow, which `startedBy` and `when` take. Constrain to it as
 * `WorkflowHandlerName<WorkflowType> & string`: the intersection written at the use site makes the compiler print a
 * misspelt name's error with the method names, such as `'"strat"' is not assignable to '"start" | "charged"'`,
 * rather than with this alias' name.
 */
type WorkflowHandlerName<WorkflowType> = Exclude<
  {
    [P in keyof WorkflowType]: WorkflowType[P] extends (
      ...args: never[]
    ) => unknown
      ? P
      : never
  }[keyof WorkflowType],
  keyof Workflow<WorkflowState>
>

/**
 * Checks the method `THandlerName` of `WorkflowType` handles `TMessage`: it can be called with the message, the
 * workflow state, the message attributes and a `HandlerContext`, and returns changes to the workflow state or
 * nothing, with no fields that aren't in the state (see `CheckedWorkflowHandler`). It's `unknown` when the method is
 * a valid handler, and otherwise a type naming what's wrong, which the method name doesn't match, so the compiler
 * reports it.
 *
 * The attributes parameter isn't checked, so a handler can declare typed attributes such as
 * `MessageAttributes<{ tenantId: string }>`. As with `CheckedWorkflowHandler`, a method with an annotated return type
 * is checked against the annotation rather than the object it returns.
 */
type CheckedClassWorkflowHandler<
  WorkflowType,
  THandlerName extends keyof WorkflowType,
  TMessage extends Message,
  WorkflowStateType extends WorkflowState
> = WorkflowType[THandlerName] extends (
  message: TMessage,
  workflowState: Readonly<WorkflowStateType>,
  // A handler may declare attributes narrower than the ones it's called with, as with handlerFor
  attributes: MessageAttributes<any, any>,
  context: HandlerContext
) => unknown
  ? unknown extends CheckedWorkflowHandler<
      WorkflowType[THandlerName],
      WorkflowStateType
    >
    ? WorkflowType[THandlerName] extends WorkflowHandler<
        TMessage,
        MessageAttributes<any, any>,
        WorkflowStateType
      >
      ? unknown
      : {
          'Handler does not return changes to the workflow state or nothing': THandlerName
        }
    : CheckedWorkflowHandler<WorkflowType[THandlerName], WorkflowStateType>
  : {
      'Handler does not take the message, the workflow state, the message attributes and a HandlerContext': THandlerName
    }

/**
 * The handler name that `startedBy` and `when` take: a method of the workflow that handles `TMessage`. When the
 * mapper's workflow type is `any`, names can't be checked, so none is accepted. `THandlerName` is `never` when the
 * workflow has no public methods, such as when its handlers are protected. The checks are written in terms of
 * `THandlerName` so they don't affect the variance of `WorkflowMapper`.
 *
 * While the workflow state is a type parameter, as in a generic workflow, TypeScript defers the checks and no name
 * is accepted, so a generic workflow types its mapper with a concrete state.
 */
type WorkflowHandlerArgument<
  WorkflowType,
  THandlerName extends keyof WorkflowType,
  TMessage extends Message,
  WorkflowStateType extends WorkflowState
> = 0 extends 1 & WorkflowType
  ? {
      'Type the mapper with the workflow class, such as WorkflowMapper<OrderState, OrderWorkflow>, not any': never
    }
  : [THandlerName] extends [never]
    ? {
        'The workflow has no public methods. Make handler methods public, since protected and private ones can not be named': never
      }
    : THandlerName &
        CheckedClassWorkflowHandler<
          WorkflowType,
          THandlerName,
          TMessage,
          WorkflowStateType
        >

/**
 * A `when` handler of a class workflow, as the mapper stores it
 */
export type OnWhenHandler = {
  workflowCtor: ClassConstructor<Workflow<WorkflowState>>
  workflowHandler: string
  customLookup: MessageWorkflowMapping | undefined
}

/**
 * What's wrong with the arguments given to `startedBy` or `when`, if anything
 */
const findMappingProblem = (
  message: unknown,
  workflowHandler: unknown,
  customLookup: unknown
): string | undefined => {
  if (message === undefined || message === null) {
    return `no message (${String(message)})`
  }
  if (typeof workflowHandler !== 'string') {
    return `a handler name that isn't a string (${String(workflowHandler)})`
  }
  if (customLookup === undefined) {
    return undefined
  }
  if (typeof customLookup !== 'object' || customLookup === null) {
    return `a lookup that isn't an object (${String(customLookup)})`
  }
  const { lookup, mapsTo } = customLookup as Partial<MessageWorkflowMapping>
  if (typeof lookup !== 'function') {
    return "a lookup whose lookup isn't a function"
  }
  if (typeof mapsTo !== 'string') {
    return "a lookup whose mapsTo isn't a string"
  }
  return undefined
}

/**
 * A workflow configuration that describes how to map incoming messages to handlers within the workflow.
 */
export class WorkflowMapper<
  out WorkflowStateType extends WorkflowState,
  out WorkflowType extends Workflow<WorkflowStateType>
> {
  readonly onStartedBy = new Map<
    MessageDeclaration<Message>,
    {
      workflowCtor: ClassConstructor<Workflow<WorkflowState>>
      workflowHandler: string
    }
  >()
  readonly onWhen = new Map<MessageDeclaration<Message>, OnWhenHandler>()
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
   * @param message The message that starts the workflow: a message class, or a definition from `defineCommand` or
   * `defineEvent`
   * @param workflowHandler The name of the workflow method that handles `message`. It must take `message` and return
   * changes to the workflow state, or nothing, with no fields that aren't in the state.
   * @throws WorkflowAlreadyStartedByMessage if the workflow is already started by `message`
   * @throws WorkflowMappingInvalid if `message` is missing or `workflowHandler` isn't a string
   * @example
   * mapper.withState(OrderState).startedBy(OrderPlaced, 'start')
   */
  startedBy<
    MessageType extends Message,
    THandlerName extends WorkflowHandlerName<WorkflowType> & string
  >(
    message: MessageDeclaration<MessageType>,
    workflowHandler: WorkflowHandlerArgument<
      WorkflowType,
      THandlerName,
      MessageType,
      WorkflowStateType
    >
  ): this {
    this.assertMapping('startedBy', message, workflowHandler, undefined)
    if (this.onStartedBy.has(message)) {
      throw new WorkflowAlreadyStartedByMessage(this.workflow.name, message)
    }
    this.onStartedBy.set(message, {
      workflowHandler: workflowHandler as THandlerName,
      workflowCtor: this.workflow
    })
    return this
  }

  /**
   * Dispatches `message` to the workflow instances it maps to
   * @param message The message to handle: a message class, or a definition from `defineCommand` or `defineEvent`
   * @param workflowHandler The name of the workflow method that handles `message`. It must take `message` and return
   * changes to the workflow state, or nothing, with no fields that aren't in the state.
   * @param customLookup How to find the workflow instance for `message`. By default it's found by the `workflowId`
   * sticky attribute that's added to messages sent from the workflow.
   * @throws WorkflowAlreadyHandlesMessage if the workflow already handles `message`
   * @throws WorkflowMappingInvalid if `message` is missing, `workflowHandler` isn't a string, or `customLookup` has
   * no `lookup` function or `mapsTo` field
   * @example
   * mapper.when(CardCharged, 'charged', { lookup: message => message.orderId, mapsTo: 'orderId' })
   */
  when<
    MessageType extends Message,
    THandlerName extends WorkflowHandlerName<WorkflowType> & string
  >(
    message: MessageDeclaration<MessageType>,
    workflowHandler: WorkflowHandlerArgument<
      WorkflowType,
      THandlerName,
      MessageType,
      WorkflowStateType
    >,
    customLookup?: MessageWorkflowMapping<MessageType, WorkflowStateType>
  ): this {
    this.assertMapping('when', message, workflowHandler, customLookup)
    if (this.onWhen.has(message)) {
      throw new WorkflowAlreadyHandlesMessage(this.workflow.name, message)
    }
    this.onWhen.set(message, {
      workflowHandler: workflowHandler as THandlerName,
      workflowCtor: this.workflow,
      customLookup: customLookup as MessageWorkflowMapping<
        Message,
        WorkflowState
      >
    })
    return this
  }

  /**
   * Checks what `startedBy` or `when` was given can be used, since a value that's undefined at runtime, such as one
   * read from a field of the workflow that `configureWorkflow` is called without, would otherwise only fail when a
   * message is handled
   */
  private assertMapping(
    mapperMethod: 'startedBy' | 'when',
    message: unknown,
    workflowHandler: unknown,
    customLookup: unknown
  ): void {
    const problem = findMappingProblem(message, workflowHandler, customLookup)
    if (problem) {
      throw new WorkflowMappingInvalid(
        this.workflow.name,
        mapperMethod,
        problem
      )
    }
  }
}

/**
 * A workflow declared as a class. Its handlers are methods, which `configureWorkflow` maps messages to by name. What
 * each handler takes and returns is checked against the message it's mapped to and the workflow state, so a handler
 * that would fail at runtime doesn't compile.
 * @example
 * export class OrderWorkflow extends Workflow<OrderState> {
 *   configureWorkflow(mapper: WorkflowMapper<OrderState, OrderWorkflow>) {
 *     mapper.withState(OrderState).startedBy(OrderPlaced, 'start')
 *   }
 *
 *   start(message: OrderPlaced) {
 *     return { orderId: message.orderId }
 *   }
 * }
 */
export abstract class Workflow<WorkflowStateType extends WorkflowState> {
  /**
   * Maps the messages the workflow handles to its handler methods. The bus calls it once when it provisions or
   * initializes, on an instance created from the class' prototype without running its constructor, so it can't use
   * the workflow's fields or dependencies; use those in the handler methods. Declare it as a method, not as an arrow
   * function property.
   * @param mapper Declares the workflow state, and which methods start the workflow or handle messages. Type it with
   * the workflow class, such as `WorkflowMapper<OrderState, OrderWorkflow>`, so handler names are checked. With
   * `any` no handler name compiles.
   */
  abstract configureWorkflow(
    mapper: WorkflowMapper<WorkflowStateType, this>
  ): void

  /**
   * Ends the workflow and optionally sets any final state. After this is returned,
   * the workflow instance will no longer be activated for subsequent messages.
   * @param workflowState Final changes to the workflow state to save with it
   * @returns The changes to return from the handler
   */
  protected completeWorkflow(
    workflowState?: WorkflowStateChange<WorkflowStateType>
  ): WorkflowStateChange<WorkflowStateType> {
    // TypeScript can't tell `$status` is a field of a generic state, though every WorkflowState has it
    return {
      ...workflowState,
      $status: WorkflowStatus.Complete
    } as WorkflowStateChange<WorkflowStateType>
  }

  /**
   * Prevents a new workflow from starting, and prevents the persistence of
   * the workflow state. This should only be used in `startedBy` workflow handlers.
   * @returns The result to return from the handler
   */
  protected discardWorkflow(): WorkflowStateChange<WorkflowStateType> {
    return {
      $status: WorkflowStatus.Discard
    } as WorkflowStateChange<WorkflowStateType>
  }
}
