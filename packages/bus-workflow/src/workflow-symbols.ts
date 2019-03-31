export const WORKFLOW_SYMBOLS = {
  Persistence: Symbol.for('node-ts/workflow/persistence'),
  WorkflowRegistry: Symbol.for('node-ts/workflow/workflow-registry')
}

export const WORKFLOW_INTERNAL_SYMBOLS = {
  StartedByProxy: Symbol.for('node-ts/workflow/started-by-proxy'),
  HandlesProxy: Symbol.for('node-ts/workflow/handles-proxy')
}
