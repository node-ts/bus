import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage,
  WorkflowDoesNotHandleMessage
} from './error'
import {
  FunctionWorkflowDefinition,
  FunctionWorkflowHandler
} from './function-workflow-definition'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowContext } from './workflow-context'
import { WorkflowState, WorkflowStateConstructor } from './workflow-state'
import {
  CheckedWorkflowHandler,
  WorkflowHandlerResult
} from './workflow-state-change'

/**
 * A handler of a workflow declared with `defineWorkflow`. Its parameters are checked bivariantly, like a method's,
 * so a handler that annotates its context with narrower attributes, such as
 * `WorkflowContext<OrderState, MessageAttributes<{ tenantId: string }>>`, is still a handler.
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
  TMessageAttributes extends MessageAttributes = MessageAttributes
> = {
  bivarianceHack(
    message: TMessage,
    workflowState: Readonly<TWorkflowState>,
    context: WorkflowContext<TWorkflowState, TMessageAttributes>
  ):
    | WorkflowHandlerResult<TWorkflowState>
    | Promise<WorkflowHandlerResult<TWorkflowState>>
}['bivarianceHack']

/**
 * A handler of a workflow declared with `defineWorkflow`, as returned by `startedByHandler` and `whenHandler` to
 * call it directly, such as in a test
 * @param message The message to handle
 * @param workflowState The current workflow state
 * @param context The workflow context, such as one from `workflowContext()` in a test
 * @returns Changes to the workflow state to save, or nothing to leave it unchanged
 */
export type WorkflowHandlerCall<
  TMessage extends Message,
  TWorkflowState extends WorkflowState
> = {
  bivarianceHack(
    message: TMessage,
    workflowState: Readonly<TWorkflowState>,
    context: WorkflowContext<TWorkflowState>
  ): Promise<WorkflowHandlerResult<TWorkflowState>>
}['bivarianceHack']

/**
 * A workflow declared with `defineWorkflow`. Each `startedBy` and `when` returns a new workflow with the handler
 * added, so a workflow can be built up step by step and registered with `withWorkflow()`.
 *
 * What a handler returns is checked against the workflow state: fields of the wrong type, and fields at any depth
 * that aren't in the state, don't compile. See `CheckedWorkflowHandler` for what can't be checked.
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
   * Starts a new instance of the workflow each time `message` is handled.
   *
   * Messages are delivered at least once and starts aren't deduplicated, so a `message` that's retried after the
   * new workflow state was saved starts a second workflow instance. Make the handler idempotent, such as by
   * returning `ctx.discard()` when a workflow already exists for the message, if that matters.
   * @param message The message that starts the workflow: a message class, or a definition from `defineCommand` or
   * `defineEvent`
   * @param handler Handles `message`, and returns the initial workflow state
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
    THandler extends WorkflowHandlerFunction<TMessage, TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    handler: THandler & CheckedWorkflowHandler<THandler, TWorkflowState>
  ): FunctionWorkflow<TWorkflowState>

  /**
   * Dispatches `message` to the running instances of the workflow that have the `workflowId` sticky attribute of
   * the message. Messages sent from the workflow, and replies to them, carry it.
   * @param message The message to handle: a message class, or a definition from `defineCommand` or `defineEvent`
   * @param handler Handles `message`
   * @returns A new workflow with the handler added
   * @throws WorkflowAlreadyHandlesMessage if the workflow already handles `message`
   * @example
   * defineWorkflow(OrderState)
   *   .startedBy(OrderPlaced, ...)
   *   .when(CardCharged, (_message, _state, ctx) => ctx.complete({ charged: true }))
   */
  when<
    TMessage extends Message,
    THandler extends WorkflowHandlerFunction<TMessage, TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    handler: THandler & CheckedWorkflowHandler<THandler, TWorkflowState>
  ): FunctionWorkflow<TWorkflowState>

  /**
   * Dispatches `message` to the running instances of the workflow that `mapping` finds
   * @param message The message to handle: a message class, or a definition from `defineCommand` or `defineEvent`
   * @param mapping Finds the workflow instances whose `mapsTo` field matches the value `lookup` returns for
   * `message`. `mapsTo` must be a field of the workflow state.
   * @param handler Handles `message`
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
    THandler extends WorkflowHandlerFunction<TMessage, TWorkflowState>
  >(
    message: MessageDeclaration<TMessage>,
    mapping: MessageWorkflowMapping<TMessage, TWorkflowState>,
    handler: THandler & CheckedWorkflowHandler<THandler, TWorkflowState>
  ): FunctionWorkflow<TWorkflowState>

  /**
   * Gets the `startedBy` handler of `message`, typed by the message, to call it directly in a test
   * @param message The message the workflow is started by
   * @returns The handler
   * @throws WorkflowDoesNotHandleMessage if the workflow isn't started by `message`
   * @example
   * const result = await orderWorkflow.startedByHandler(OrderPlaced)(OrderPlaced({ orderId: '1' }), state, workflowContext())
   */
  startedByHandler<TMessage extends Message>(
    message: MessageDeclaration<TMessage>
  ): WorkflowHandlerCall<TMessage, TWorkflowState>

  /**
   * Gets the `when` handler of `message`, typed by the message, to call it directly in a test
   * @param message The message the workflow handles
   * @returns The handler
   * @throws WorkflowDoesNotHandleMessage if the workflow has no `when` handler for `message`
   * @example
   * const result = await orderWorkflow.whenHandler(CardCharged)(new CardCharged('1'), state, workflowContext())
   */
  whenHandler<TMessage extends Message>(
    message: MessageDeclaration<TMessage>
  ): WorkflowHandlerCall<TMessage, TWorkflowState>
}

/**
 * Any handler passed to `startedBy` or `when`. They're typed by message on the way in, and called with the message
 * they're registered for.
 */
type AnyWorkflowHandler<TWorkflowState extends WorkflowState> =
  WorkflowHandlerFunction<Message, TWorkflowState>

const toHandler = <TWorkflowState extends WorkflowState>(
  messageType: MessageDeclaration<Message>,
  customLookup: MessageWorkflowMapping<Message, TWorkflowState> | undefined,
  handler: AnyWorkflowHandler<TWorkflowState>
): FunctionWorkflowHandler<TWorkflowState> => ({
  messageType,
  customLookup: customLookup as MessageWorkflowMapping | undefined,
  handle: async (message, workflowState, context) =>
    handler(message, workflowState, context)
})

const findHandler = <TWorkflowState extends WorkflowState>(
  name: string,
  handlers: ReadonlyArray<FunctionWorkflowHandler<TWorkflowState>>,
  message: MessageDeclaration<Message>,
  handlerKind: 'startedBy' | 'when'
): FunctionWorkflowHandler<TWorkflowState> => {
  const handler = handlers.find(h => h.messageType === message)
  if (!handler) {
    throw new WorkflowDoesNotHandleMessage(name, message, handlerKind)
  }
  return handler
}

const createFunctionWorkflow = <TWorkflowState extends WorkflowState>(
  name: string,
  workflowStateType: WorkflowStateConstructor<TWorkflowState>,
  startedByHandlers: ReadonlyArray<FunctionWorkflowHandler<TWorkflowState>>,
  whenHandlers: ReadonlyArray<FunctionWorkflowHandler<TWorkflowState>>
): FunctionWorkflowDefinition<TWorkflowState> =>
  Object.freeze({
    name,
    workflowStateType,
    startedByHandlers: Object.freeze([...startedByHandlers]),
    whenHandlers: Object.freeze([...whenHandlers]),
    startedBy: (
      message: MessageDeclaration<Message>,
      handler: AnyWorkflowHandler<TWorkflowState>
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
        | MessageWorkflowMapping<Message, TWorkflowState>
        | AnyWorkflowHandler<TWorkflowState>,
      handler?: AnyWorkflowHandler<TWorkflowState>
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
    },
    startedByHandler: (message: MessageDeclaration<Message>) =>
      findHandler(name, startedByHandlers, message, 'startedBy').handle,
    whenHandler: (message: MessageDeclaration<Message>) =>
      findHandler(name, whenHandlers, message, 'when').handle
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
