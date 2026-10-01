import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage
} from './error'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowContext } from './workflow-context'
import { WorkflowState, WorkflowStateConstructor } from './workflow-state'
import {
  ExactWorkflowHandlerResult,
  WorkflowHandlerResult
} from './workflow-state-change'

/**
 * A handler of a workflow declared with `defineWorkflow`
 * @param message The message that was received
 * @param workflowState The current, read-only state of the workflow instance. In a `startedBy` handler it's the new
 * state, with only `$workflowId`, `$status` and `$version` set.
 * @param context Sends and publishes through the bus that received the message, has the message's attributes, and
 * ends the workflow with `complete()` or `discard()`
 * @returns Changes to the workflow state to save, or nothing to leave it unchanged
 * @example
 * const charged: WorkflowHandlerFunction<CardCharged, OrderState> = (_message, _state, ctx) =>
 *   ctx.complete({ charged: true })
 */
export type WorkflowHandlerFunction<
  TMessage extends Message,
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes,
  TResult = WorkflowHandlerResult<TWorkflowState>
> = (
  message: TMessage,
  workflowState: Readonly<TWorkflowState>,
  context: WorkflowContext<TWorkflowState, TMessageAttributes>
) => TResult | Promise<TResult>

/**
 * A message handler of a workflow declared with `defineWorkflow`, as it's registered with the bus
 */
export interface FunctionWorkflowHandler<TWorkflowState extends WorkflowState> {
  /**
   * The type of message the handler handles
   */
  readonly messageType: MessageDeclaration<Message>

  /**
   * How a `when` handler finds the workflow instances for a message. When it's `undefined` they're found by the
   * `workflowId` sticky attribute.
   */
  readonly customLookup: MessageWorkflowMapping | undefined

  /**
   * Calls the handler
   * @param message The message that was received
   * @param workflowState The current, read-only state of the workflow instance
   * @param context The workflow context of the message
   * @returns Changes to the workflow state to save, or nothing to leave it unchanged
   */
  handle(
    message: Message,
    workflowState: Readonly<TWorkflowState>,
    context: WorkflowContext<TWorkflowState>
  ):
    | WorkflowHandlerResult<TWorkflowState>
    | Promise<WorkflowHandlerResult<TWorkflowState>>
}

/**
 * A workflow declared with `defineWorkflow`. Each `startedBy` and `when` returns a new workflow with the handler
 * added, so a workflow can be built up step by step and registered with `withWorkflow()`.
 */
export interface FunctionWorkflow<TWorkflowState extends WorkflowState> {
  /**
   * The name of the workflow, which is the `$name` of its state
   */
  readonly name: string

  /**
   * The class of the workflow's state
   */
  readonly workflowStateType: WorkflowStateConstructor<TWorkflowState>

  /**
   * The handlers of messages that start the workflow
   */
  readonly startedByHandlers: ReadonlyArray<
    FunctionWorkflowHandler<TWorkflowState>
  >

  /**
   * The handlers of messages that are dispatched to running instances of the workflow
   */
  readonly whenHandlers: ReadonlyArray<FunctionWorkflowHandler<TWorkflowState>>

  /**
   * Starts a new instance of the workflow each time `message` is handled.
   *
   * Messages are delivered at least once and starts aren't deduplicated, so a `message` that's retried after the
   * new workflow state was saved starts a second workflow instance. Make the handler idempotent, such as by
   * returning `ctx.discard()` when a workflow already exists for the message, if that matters.
   * @param message The message that starts the workflow: a message class, or a definition from `defineCommand` or
   * `defineEvent`
   * @param handler Handles `message`, and returns the initial workflow state. Fields it returns that aren't in the
   * workflow state don't compile.
   * @returns A new workflow with the handler added
   * @throws WorkflowAlreadyStartedByMessage if the workflow is already started by `message`
   * @example
   * defineWorkflow(OrderState).startedBy(OrderPlaced, async (message, _state, ctx) => {
   *   await ctx.send(new ChargeCard(message.orderId))
   *   return { orderId: message.orderId }
   * })
   */
  startedBy<
    TMessage extends Message,
    TMessageAttributes extends MessageAttributes = MessageAttributes,
    TResult = WorkflowHandlerResult<TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    handler: WorkflowHandlerFunction<
      TMessage,
      TWorkflowState,
      TMessageAttributes,
      ExactWorkflowHandlerResult<TWorkflowState, TResult>
    >
  ): FunctionWorkflow<TWorkflowState>

  /**
   * Dispatches `message` to the running instances of the workflow that have the `workflowId` sticky attribute of
   * the message. Messages sent from the workflow, and replies to them, carry it.
   * @param message The message to handle: a message class, or a definition from `defineCommand` or `defineEvent`
   * @param handler Handles `message`. Fields it returns that aren't in the workflow state don't compile.
   * @returns A new workflow with the handler added
   * @throws WorkflowAlreadyHandlesMessage if the workflow already handles `message`
   * @example
   * defineWorkflow(OrderState)
   *   .startedBy(OrderPlaced, ...)
   *   .when(CardCharged, (_message, _state, ctx) => ctx.complete({ charged: true }))
   */
  when<
    TMessage extends Message,
    TMessageAttributes extends MessageAttributes = MessageAttributes,
    TResult = WorkflowHandlerResult<TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    handler: WorkflowHandlerFunction<
      TMessage,
      TWorkflowState,
      TMessageAttributes,
      ExactWorkflowHandlerResult<TWorkflowState, TResult>
    >
  ): FunctionWorkflow<TWorkflowState>

  /**
   * Dispatches `message` to the running instances of the workflow that `mapping` finds
   * @param message The message to handle: a message class, or a definition from `defineCommand` or `defineEvent`
   * @param mapping Finds the workflow instances whose `mapsTo` field matches the value `lookup` returns for
   * `message`. `mapsTo` must be a field of the workflow state.
   * @param handler Handles `message`. Fields it returns that aren't in the workflow state don't compile.
   * @returns A new workflow with the handler added
   * @throws WorkflowAlreadyHandlesMessage if the workflow already handles `message`
   * @example
   * defineWorkflow(OrderState)
   *   .startedBy(OrderPlaced, ...)
   *   .when(CardCharged, { lookup: m => m.orderId, mapsTo: 'orderId' }, (_message, _state, ctx) =>
   *     ctx.complete({ charged: true })
   *   )
   */
  when<
    TMessage extends Message,
    TMessageAttributes extends MessageAttributes = MessageAttributes,
    TResult = WorkflowHandlerResult<TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    mapping: MessageWorkflowMapping<TMessage, TWorkflowState>,
    handler: WorkflowHandlerFunction<
      TMessage,
      TWorkflowState,
      TMessageAttributes,
      ExactWorkflowHandlerResult<TWorkflowState, TResult>
    >
  ): FunctionWorkflow<TWorkflowState>
}

const toHandler = <TWorkflowState extends WorkflowState>(
  messageType: MessageDeclaration<Message>,
  customLookup: MessageWorkflowMapping<any, TWorkflowState> | undefined,
  handler: WorkflowHandlerFunction<any, TWorkflowState, any, any>
): FunctionWorkflowHandler<TWorkflowState> => ({
  messageType,
  customLookup: customLookup as MessageWorkflowMapping | undefined,
  handle: (message, workflowState, context) =>
    handler(message, workflowState, context)
})

const createFunctionWorkflow = <TWorkflowState extends WorkflowState>(
  name: string,
  workflowStateType: WorkflowStateConstructor<TWorkflowState>,
  startedByHandlers: FunctionWorkflowHandler<TWorkflowState>[],
  whenHandlers: FunctionWorkflowHandler<TWorkflowState>[]
): FunctionWorkflow<TWorkflowState> =>
  Object.freeze({
    name,
    workflowStateType,
    startedByHandlers: Object.freeze([...startedByHandlers]),
    whenHandlers: Object.freeze([...whenHandlers]),
    startedBy: (
      message: MessageDeclaration<Message>,
      handler: WorkflowHandlerFunction<any, TWorkflowState, any, any>
    ) => {
      if (startedByHandlers.some(h => h.messageType === message)) {
        throw new WorkflowAlreadyStartedByMessage(name, message)
      }
      return createFunctionWorkflow(
        name,
        workflowStateType,
        [...startedByHandlers, toHandler(message, undefined, handler)],
        whenHandlers
      )
    },
    when: (
      message: MessageDeclaration<Message>,
      mappingOrHandler:
        | MessageWorkflowMapping<any, TWorkflowState>
        | WorkflowHandlerFunction<any, TWorkflowState, any, any>,
      handler?: WorkflowHandlerFunction<any, TWorkflowState, any, any>
    ) => {
      if (whenHandlers.some(h => h.messageType === message)) {
        throw new WorkflowAlreadyHandlesMessage(name, message)
      }
      const whenHandler =
        typeof mappingOrHandler === 'function'
          ? toHandler(message, undefined, mappingOrHandler)
          : toHandler(message, mappingOrHandler, handler!)
      return createFunctionWorkflow(
        name,
        workflowStateType,
        startedByHandlers,
        [...whenHandlers, whenHandler]
      )
    }
  })

/**
 * Declares a workflow with plain functions, as an alternative to a class that extends `Workflow`. Its handlers get
 * the message, the workflow state and a `WorkflowContext` to send, publish, read the message attributes and end the
 * workflow, so they need no container and can be unit tested by calling them directly.
 *
 * Register it with `Bus.configure().withWorkflow(workflow)`. It's handled, persisted and retried the same way as a
 * class workflow. The workflow state class is in the message types that `bus generate-message-types` generates, so
 * its Dates, Maps, Sets and classes are restored.
 * @param workflowStateType The class of the workflow's state. It extends `WorkflowState`, has a unique `$name` and
 * is constructed with no arguments. Its `$name` is the name of the workflow.
 * @returns A workflow with no handlers. Add them with `startedBy` and `when`.
 * @example
 * export const orderWorkflow = defineWorkflow(OrderState)
 *   .startedBy(OrderPlaced, async (message, _state, ctx) => {
 *     await ctx.send(new ChargeCard(message.orderId))
 *     return { orderId: message.orderId }
 *   })
 *   .when(CardCharged, { lookup: m => m.orderId, mapsTo: 'orderId' }, (_message, _state, ctx) =>
 *     ctx.complete({ charged: true })
 *   )
 *
 * Bus.configure().withWorkflow(orderWorkflow)
 */
export const defineWorkflow = <TWorkflowState extends WorkflowState>(
  workflowStateType: WorkflowStateConstructor<TWorkflowState>
): FunctionWorkflow<TWorkflowState> =>
  createFunctionWorkflow(
    new workflowStateType().$name,
    workflowStateType,
    [],
    []
  )
