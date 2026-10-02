/**
 * Thrown when `withWorkflow()` is given something that's neither a class that extends `Workflow` nor a workflow
 * returned by `defineWorkflow`
 */
export class WorkflowNotRecognized extends Error {
  readonly help =
    'Pass a class that extends Workflow, or the workflow that defineWorkflow(State).startedBy(...) returns. A' +
    ' workflow object built by hand has no handlers the bus can read.'

  /**
   * @param workflow What was passed to `withWorkflow()`
   */
  constructor(readonly workflow: unknown) {
    super(
      'Attempted to register a workflow that is neither a class that extends Workflow nor declared with defineWorkflow'
    )

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
