import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { HandlerContext } from '../handler'
import { ClassConstructor } from '../util'
import {
  FunctionWorkflow,
  MessageWorkflowMapping,
  Workflow,
  WorkflowHandlerResult,
  WorkflowMapper,
  WorkflowState,
  WorkflowStateNotProvided,
  WorkflowStatus
} from '../workflow'
import { applyWorkflowStateChange } from '../workflow/apply-workflow-state-change'
import {
  FunctionWorkflowDefinition,
  isFunctionWorkflow
} from '../workflow/function-workflow-definition'
import { InvalidTimeAdvance, MessageNotHandledByWorkflow } from './error'
import { RecordedMessage } from './recorded-message'
import {
  handlerContext,
  RecordingHandlerContext
} from './recording-handler-context'
import { workflowContext } from './recording-workflow-context'
import { ScheduledMessage } from './scheduled-message'
import { WorkflowScenario } from './workflow-scenario'
import { WorkflowScenarioOptions } from './workflow-scenario-options'
import { WorkflowScenarioResult } from './workflow-scenario-result'

/**
 * Calls one handler of the workflow under test with a recording context
 */
type ScenarioHandler<TWorkflowState extends WorkflowState> = (
  message: Message,
  workflowState: Readonly<TWorkflowState>,
  attributes: MessageAttributes
) => Promise<{
  output: WorkflowHandlerResult<TWorkflowState>
  context: RecordingHandlerContext
}>

/**
 * The handlers of the workflow under test by message name, whichever way it was declared
 */
interface ScenarioWorkflow<TWorkflowState extends WorkflowState> {
  name: string
  workflowStateType: ClassConstructor<TWorkflowState>
  startedBy: Map<string, ScenarioHandler<TWorkflowState>>
  when: Map<
    string,
    {
      handle: ScenarioHandler<TWorkflowState>
      mapping: MessageWorkflowMapping | undefined
    }
  >
}

/**
 * A scheduled message, with the attributes it's delivered with
 */
interface PendingMessage {
  scheduled: ScheduledMessage
  attributes: MessageAttributes
}

const readFunctionWorkflow = <TWorkflowState extends WorkflowState>(
  workflow: FunctionWorkflowDefinition<TWorkflowState>,
  contextOverrides: Partial<HandlerContext>
): ScenarioWorkflow<TWorkflowState> => {
  const handlerOf =
    (
      handler: FunctionWorkflowDefinition<TWorkflowState>['startedByHandlers'][number]
    ): ScenarioHandler<TWorkflowState> =>
    async (message, workflowState, attributes) => {
      const context = workflowContext<TWorkflowState>({
        correlationId: attributes.correlationId,
        ...contextOverrides,
        attributes
      })
      const output = await handler.handle(message, workflowState, context)
      return { output, context }
    }

  return {
    name: workflow.name,
    workflowStateType: workflow.workflowStateType,
    startedBy: new Map(
      workflow.startedByHandlers.map(handler => [
        handler.messageType.NAME,
        handlerOf(handler)
      ])
    ),
    when: new Map(
      workflow.whenHandlers.map(handler => [
        handler.messageType.NAME,
        { handle: handlerOf(handler), mapping: handler.customLookup }
      ])
    )
  }
}

const readClassWorkflow = <TWorkflowState extends WorkflowState>(
  workflowType: ClassConstructor<Workflow<TWorkflowState>>,
  createWorkflow: () => Workflow<TWorkflowState>,
  contextOverrides: Partial<HandlerContext>
): ScenarioWorkflow<TWorkflowState> => {
  const mapper = new WorkflowMapper<TWorkflowState, Workflow<TWorkflowState>>(
    workflowType
  )
  createWorkflow().configureWorkflow(mapper)
  const workflowStateType = mapper.workflowStateCtor
  if (!workflowStateType) {
    throw new WorkflowStateNotProvided(workflowType.name)
  }

  // A new workflow handles each message, as on a bus
  const handlerOf =
    (handlerName: string): ScenarioHandler<TWorkflowState> =>
    async (message, workflowState, attributes) => {
      const context = handlerContext({
        correlationId: attributes.correlationId,
        ...contextOverrides
      })
      const workflow = createWorkflow()
      const handler = (
        workflow as unknown as Record<
          string,
          (
            ...args: unknown[]
          ) =>
            | WorkflowHandlerResult<TWorkflowState>
            | Promise<WorkflowHandlerResult<TWorkflowState>>
        >
      )[handlerName]
      const output = await handler.call(
        workflow,
        message,
        workflowState,
        attributes,
        context
      )
      return { output, context }
    }

  return {
    name: workflowType.name,
    workflowStateType,
    startedBy: new Map(
      Array.from(mapper.onStartedBy, ([messageType, { workflowHandler }]) => [
        messageType.NAME,
        handlerOf(workflowHandler)
      ])
    ),
    when: new Map(
      Array.from(
        mapper.onWhen,
        ([messageType, { workflowHandler, customLookup }]) => [
          messageType.NAME,
          { handle: handlerOf(workflowHandler), mapping: customLookup }
        ]
      )
    )
  }
}

/**
 * Whether a message reaches a workflow instance, by the same mapping the persistence matches on
 */
const mapsToInstance = (
  mapping: MessageWorkflowMapping | undefined,
  message: Message,
  attributes: MessageAttributes,
  workflowState: WorkflowState
): boolean => {
  if (!mapping) {
    const workflowId: unknown = attributes.stickyAttributes.workflowId
    return !!workflowId && workflowId === workflowState.$workflowId
  }
  const lookupValue = mapping.lookup(message, attributes)
  return (
    !!lookupValue &&
    (workflowState as unknown as Record<string, unknown>)[mapping.mapsTo] ===
      lookupValue
  )
}

/**
 * When a message sent with `deliverAfter` or `deliverAt` is due, or `undefined` if it's sent straight away
 */
const dueAtOf = (
  recorded: RecordedMessage,
  now: number
): number | undefined => {
  if (recorded.options.deliverAt) {
    return recorded.options.deliverAt.getTime()
  }
  if (recorded.options.deliverAfter !== undefined) {
    return now + recorded.options.deliverAfter
  }
  return undefined
}

/**
 * Creates a scenario that runs a workflow in a unit test, without a bus, transport or persistence. It works with
 * class workflows and workflows declared with `defineWorkflow`.
 *
 * The scenario follows one workflow instance. `when()` delivers a message to it and returns what the handler sent,
 * published and replied with, and the state as the bus would have saved it. `given()` sets the state to start from,
 * and `advanceTime()` moves the scenario's clock on and delivers the messages the workflow sent itself with
 * `deliverAfter` or `deliverAt`, such as timeouts. Messages it sends without a delay aren't delivered: pass them to
 * `when()` to continue the workflow with them.
 *
 * It applies the bus' rules: handlers get a frozen copy of the state, the changes they return are merged over it
 * with `$workflowId`, `$version` and `$name` kept, `complete()` ends the workflow, `discard()` saves nothing, and a
 * handler that fails or returns the message saves and sends nothing. The state isn't serialized, so it doesn't
 * check that the workflow state's message types are generated.
 * @param workflow a class that extends `Workflow`, or a workflow declared with `defineWorkflow`
 * @param options how to create a class workflow, members of every handler's context, and when the clock starts
 * @returns the scenario, with no workflow instance yet
 * @throws WorkflowStateNotProvided if a class workflow doesn't declare its state with `mapper.withState()`
 * @example
 * const scenario = testWorkflow(orderWorkflow)
 * const started = await scenario.when(OrderPlaced({ orderId: '1' }))
 * deepStrictEqual(started.sent, [{ message: new ChargeCard('1'), options: {} }])
 *
 * const charged = await scenario.when(new CardCharged('1'))
 * strictEqual(charged.status, WorkflowStatus.Complete)
 * @example
 * const [timedOut] = await testWorkflow(OrderWorkflow).given({ orderId: '1' }).advanceTime(30_000)
 */
export const testWorkflow = <TWorkflowState extends WorkflowState>(
  workflow:
    | FunctionWorkflow<TWorkflowState>
    | ClassConstructor<Workflow<TWorkflowState>>,
  options: WorkflowScenarioOptions<TWorkflowState> = {}
): WorkflowScenario<TWorkflowState> => {
  const contextOverrides = options.context ?? {}
  const scenarioWorkflow: ScenarioWorkflow<TWorkflowState> = isFunctionWorkflow(
    workflow
  )
    ? readFunctionWorkflow(
        workflow as unknown as FunctionWorkflowDefinition<TWorkflowState>,
        contextOverrides
      )
    : readClassWorkflow(
        workflow as ClassConstructor<Workflow<TWorkflowState>>,
        options.createWorkflow ??
          (() =>
            new (workflow as ClassConstructor<Workflow<TWorkflowState>>)()),
        contextOverrides
      )
  const { workflowStateType } = scenarioWorkflow

  let instance: Readonly<TWorkflowState> | undefined
  let now = (options.now ?? new Date()).getTime()
  let pending: PendingMessage[] = []

  const handles = (messageName: string): boolean =>
    scenarioWorkflow.startedBy.has(messageName) ||
    scenarioWorkflow.when.has(messageName)

  const schedule = (
    recorded: RecordedMessage[],
    attributes: MessageAttributes,
    workflowId: string
  ): void => {
    for (const message of recorded) {
      const dueAt = dueAtOf(message, now)
      if (dueAt === undefined) {
        continue
      }
      pending.push({
        scheduled: { ...message, dueAt: new Date(dueAt) },
        // What the bus sends it with: the handled message's correlation and sticky attributes, with the workflow's id
        attributes: {
          correlationId:
            message.options.correlationId ?? attributes.correlationId,
          attributes: message.options.attributes ?? {},
          stickyAttributes: {
            ...attributes.stickyAttributes,
            workflowId,
            ...message.options.stickyAttributes
          }
        }
      })
    }
    // A stable sort, so messages due at the same time are delivered in the order they were sent
    pending.sort(
      (a, b) => a.scheduled.dueAt.getTime() - b.scheduled.dueAt.getTime()
    )
  }

  const run = async (
    handle: ScenarioHandler<TWorkflowState>,
    message: Message,
    workflowState: TWorkflowState,
    attributes: MessageAttributes
  ): Promise<WorkflowScenarioResult<TWorkflowState>> => {
    // A copy, as the bus passes handlers, so a handler that changes the state instead of returning changes throws
    const immutableWorkflowState = Object.freeze({ ...workflowState })
    const { output, context } = await handle(
      message,
      immutableWorkflowState,
      attributes
    )

    const isFailedOrReturned = context.messageFailed || context.messageReturned
    if (!isFailedOrReturned) {
      const savedWorkflowState = applyWorkflowStateChange(
        immutableWorkflowState,
        output,
        workflowStateType
      )
      if (savedWorkflowState) {
        // Persistence counts each save in $version
        savedWorkflowState.$version = immutableWorkflowState.$version + 1
        instance = Object.freeze(savedWorkflowState)
      }
      schedule(
        [...context.sent, ...context.published],
        attributes,
        immutableWorkflowState.$workflowId
      )
    }

    return {
      message,
      handled: true,
      discarded: !!output && output.$status === WorkflowStatus.Discard,
      state: instance,
      status: instance?.$status,
      sent: isFailedOrReturned ? [] : [...context.sent],
      published: isFailedOrReturned ? [] : [...context.published],
      replied: isFailedOrReturned ? [] : [...context.replied],
      messageFailed: context.messageFailed,
      messageReturned: context.messageReturned
    }
  }

  const deliver = async (
    message: Message,
    attributes: MessageAttributes
  ): Promise<WorkflowScenarioResult<TWorkflowState>> => {
    const startedBy = scenarioWorkflow.startedBy.get(message.$name)
    if (startedBy) {
      const workflowState = new workflowStateType()
      workflowState.$version = 0
      workflowState.$status = WorkflowStatus.Running
      workflowState.$workflowId = randomUUID()
      return run(startedBy, message, workflowState, attributes)
    }

    const when = scenarioWorkflow.when.get(message.$name)
    if (!when) {
      throw new MessageNotHandledByWorkflow(
        scenarioWorkflow.name,
        message.$name
      )
    }
    if (
      instance?.$status === WorkflowStatus.Running &&
      mapsToInstance(when.mapping, message, attributes, instance)
    ) {
      return run(when.handle, message, instance, attributes)
    }
    // The bus ignores a message that finds no running instance, such as a timeout for a completed workflow
    return {
      message,
      handled: false,
      discarded: false,
      state: instance,
      status: instance?.$status,
      sent: [],
      published: [],
      replied: [],
      messageFailed: false,
      messageReturned: false
    }
  }

  const scenario: WorkflowScenario<TWorkflowState> = {
    get state() {
      return instance
    },

    get now() {
      return new Date(now)
    },

    get scheduled() {
      return pending.map(({ scheduled }) => scheduled)
    },

    given: workflowState => {
      instance = Object.freeze(
        Object.assign(
          new workflowStateType(),
          {
            $workflowId: randomUUID(),
            $status: WorkflowStatus.Running,
            $version: 1
          },
          workflowState
        )
      )
      return scenario
    },

    when: async (message, attributes = {}) => {
      const stickyAttributes = attributes.stickyAttributes ?? {}
      // Messages sent from the workflow, and replies to them, carry its id, which the default mapping finds it by
      const isForInstance =
        !!instance &&
        !scenarioWorkflow.startedBy.has(message.$name) &&
        !('workflowId' in stickyAttributes)
      return deliver(message, {
        ...attributes,
        attributes: attributes.attributes ?? {},
        stickyAttributes: isForInstance
          ? { ...stickyAttributes, workflowId: instance!.$workflowId }
          : stickyAttributes
      })
    },

    advanceTime: async milliseconds => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new InvalidTimeAdvance(milliseconds)
      }
      const until = now + milliseconds
      const results: WorkflowScenarioResult<TWorkflowState>[] = []
      // Handlers that run may schedule more messages that are due in time, so take the next due one each time
      while (pending.length && pending[0].scheduled.dueAt.getTime() <= until) {
        const [next, ...rest] = pending
        pending = rest
        now = Math.max(now, next.scheduled.dueAt.getTime())
        if (handles(next.scheduled.message.$name)) {
          results.push(await deliver(next.scheduled.message, next.attributes))
        }
      }
      now = until
      return results
    }
  }
  return scenario
}
