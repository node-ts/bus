import { ClassConstructor } from '@node-ts/bus-core'
import { WorkflowData } from './workflow-data'

export type WorkflowConstructor<
  TWorkflowData extends WorkflowData,
  TWorkflow extends Workflow<TWorkflowData> = Workflow<TWorkflowData>
> = ClassConstructor<TWorkflow>

export interface Workflow<TWorkflowData extends WorkflowData> {}
