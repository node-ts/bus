/**
 * Thrown when a class workflow's `configureWorkflow()` passes `startedBy` or `when` a value that can't be used: no
 * message, a handler name that isn't a string, or a lookup without a `lookup` function or a `mapsTo` field. The bus
 * reads `configureWorkflow()` without constructing the workflow, so a value held in one of its fields is `undefined`
 * there.
 */
export class WorkflowMappingInvalid extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow class
   * @param mapperMethod The mapper method that was given the value, `startedBy` or `when`
   * @param problem What's wrong with the value, such as "a lookup that isn't a function"
   */
  constructor(
    readonly workflowName: string,
    readonly mapperMethod: 'startedBy' | 'when',
    readonly problem: string
  ) {
    super(
      `Workflow ${workflowName} calls mapper.${mapperMethod}() with ${problem}`
    )
    this.help =
      `Pass mapper.${mapperMethod}() the message, the name of a handler method and, for when(), a lookup with a` +
      " lookup function and a mapsTo field. Don't read them from the workflow's fields, which aren't set when" +
      ` ${workflowName}.configureWorkflow() is called.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
