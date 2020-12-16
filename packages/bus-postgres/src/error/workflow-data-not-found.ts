export class WorkflowStateNotFound extends Error {
  constructor (
    readonly workflowId: string,
    readonly tableName: string,
    readonly version: number
  ) {
    super(`Could not find workflow data`)
  }
}
