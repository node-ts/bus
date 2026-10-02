import { WorkflowState } from '@node-ts/bus-core'

export class DocumentWorkflowState extends WorkflowState {
  static NAME = 'my-app/documents/document-workflow-state'
  $name = DocumentWorkflowState.NAME

  key: string
}
