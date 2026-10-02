import { WorkflowState } from './workflow-state'

/**
 * The changes a workflow handler returns to be merged into the workflow state and saved. It may be a copy of the
 * whole state, such as `{ ...state, orderId }`: `$workflowId`, `$version` and `$name` are managed by the bus, so
 * any values returned for them are ignored.
 * @example
 * const change: WorkflowStateChange<OrderState> = { orderId: '1' }
 */
export type WorkflowStateChange<TWorkflowState extends WorkflowState> =
  Partial<TWorkflowState>

/**
 * What a workflow handler returns: changes to the workflow state to save, or nothing to leave it unchanged
 */
export type WorkflowHandlerResult<TWorkflowState extends WorkflowState> =
  void | WorkflowStateChange<TWorkflowState>

/**
 * Values whose fields aren't compared with the workflow state
 */
type OpaqueValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | Map<unknown, unknown>
  | Set<unknown>
  | ((...args: never[]) => unknown)

/**
 * The paths of fields in `TValue` that aren't in `TTarget`, at any depth, such as `'total'` or `'customer.nickname'`.
 * It's `never` when every field is in `TTarget`. Unions are checked member by member.
 *
 * Nothing is checked when `TValue` is `any`, or when `TTarget` has no known fields, such as `unknown`, `object` or
 * `Record<string, unknown>`: any field fits it.
 * @example
 * type Extra = UnknownWorkflowStateFields<{ orderId: string; total: number }, OrderState> // 'total'
 */
export type UnknownWorkflowStateFields<
  TValue,
  TTarget,
  TPath extends string = ''
> = 0 extends 1 & TValue
  ? never
  : unknown extends TTarget
    ? never
    : string extends keyof NonNullable<TTarget>
      ? never
      : [keyof NonNullable<TTarget>] extends [never]
        ? never
        : UnknownFieldsOfValue<TValue, TTarget, TPath>

/**
 * `UnknownWorkflowStateFields` once `TTarget` is known to have fields
 */
type UnknownFieldsOfValue<
  TValue,
  TTarget,
  TPath extends string
> = TValue extends OpaqueValue
  ? never
  : TValue extends readonly (infer TElement)[]
    ? NonNullable<TTarget> extends readonly (infer TTargetElement)[]
      ? UnknownWorkflowStateFields<TElement, TTargetElement, `${TPath}[]`>
      : never
    : TValue extends object
      ? {
          [
            TKey in keyof TValue & string
          ]: TKey extends keyof NonNullable<TTarget>
            ? UnknownWorkflowStateFields<
                TValue[TKey],
                NonNullable<TTarget>[TKey],
                `${TPath}${TKey}.`
              >
            : `${TPath}${TKey}`
        }[keyof TValue & string]
      : never

/**
 * Checks what a workflow handler `THandler` returns has no fields, at any depth, that aren't in the workflow state.
 * TypeScript doesn't flag extra fields in an object returned from a callback, so a misspelt field would otherwise
 * compile and be saved. It's `unknown` when the handler is valid, and otherwise a type naming the unknown fields,
 * which the handler doesn't match, so the compiler reports them.
 *
 * Only what the handler's type says it returns can be checked. A handler annotated with a return type, or declared
 * with a `WorkflowHandlerFunction` type annotation, is checked against that type rather than the object it returns.
 */
export type CheckedWorkflowHandler<
  THandler,
  TWorkflowState extends WorkflowState
> = THandler extends (...args: never[]) => infer TReturn
  ? [UnknownWorkflowStateFields<Awaited<TReturn>, TWorkflowState>] extends [
      never
    ]
    ? unknown
    : {
        'Fields that are not in the workflow state': UnknownWorkflowStateFields<
          Awaited<TReturn>,
          TWorkflowState
        >
      }
  : unknown
