import { HandlerContext } from '../handler'
import { Workflow, WorkflowState } from '../workflow'

/**
 * Options of a `testWorkflow()` scenario
 */
export interface WorkflowScenarioOptions<TWorkflowState extends WorkflowState> {
  /**
   * Creates the class workflow that handles each message, such as with fake dependencies. Only used for class
   * workflows.
   *
   * Without it, a class whose constructor declares arguments throws `WorkflowFactoryMissing`. That check reads the
   * constructor's `length`, so it misses a subclass that declares no constructor, such as `class Derived extends Base
   * {}` whose `Base` takes dependencies. Give such a class `createWorkflow` too.
   * @default the workflow class constructed with no arguments, as on a bus without a container
   */
  createWorkflow?: () => Workflow<TWorkflowState>

  /**
   * Members of the context that every handler is called with, such as a fake for a field that a persistence adds.
   * The `correlationId` is the delivered message's unless it's given here. Replacing a function stops it from being
   * recorded.
   */
  context?: Partial<HandlerContext>

  /**
   * The time the scenario's clock starts at. `advanceTime()` moves it on, and `deliverAt` is compared with it.
   * @default the current time
   */
  now?: Date
}
