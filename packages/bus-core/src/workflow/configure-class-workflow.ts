import { ClassConstructor } from '../util'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage,
  WorkflowConfigurationFailed,
  WorkflowMappingInvalid,
  WorkflowStateNotProvided
} from './error'
import { Workflow, WorkflowMapper } from './workflow'
import { WorkflowState } from './workflow-state'

/**
 * A class workflow's mapping, as its `configureWorkflow()` declared it
 */
export interface ClassWorkflowConfiguration<
  TWorkflowState extends WorkflowState
> {
  mapper: WorkflowMapper<TWorkflowState, Workflow<TWorkflowState>>
  workflowStateType: ClassConstructor<TWorkflowState>
}

/**
 * Reads a class workflow's mapping by calling its `configureWorkflow()` on an instance created from its prototype,
 * without running its constructor, so neither the workflow nor its dependencies are created just to read it
 * @param workflowType the class workflow
 * @returns the mapper it configured, and its state
 * @throws WorkflowConfigurationFailed if `configureWorkflow` isn't a method, or throws an error other than the
 * mapper's `WorkflowAlreadyStartedByMessage` or `WorkflowAlreadyHandlesMessage`, such as `WorkflowMappingInvalid`
 * @throws WorkflowStateNotProvided if it doesn't declare its state with `mapper.withState()`
 */
export const configureClassWorkflow = <TWorkflowState extends WorkflowState>(
  workflowType: ClassConstructor<Workflow<TWorkflowState>>
): ClassWorkflowConfiguration<TWorkflowState> => {
  // An arrow function property only exists on instances, which aren't created here
  if (typeof workflowType.prototype.configureWorkflow !== 'function') {
    throw new WorkflowConfigurationFailed(
      workflowType.name,
      new TypeError(`configureWorkflow isn't a method of ${workflowType.name}`),
      `Declare ${workflowType.name}.configureWorkflow(mapper) as a method, not as a property holding an arrow` +
        ' function: the bus calls it without constructing the workflow, so properties are never set.'
    )
  }
  const mapper = new WorkflowMapper<TWorkflowState, Workflow<TWorkflowState>>(
    workflowType
  )
  const unconstructed = Object.create(
    workflowType.prototype as object
  ) as Workflow<TWorkflowState>
  try {
    unconstructed.configureWorkflow(mapper)
  } catch (error) {
    if (
      error instanceof WorkflowAlreadyStartedByMessage ||
      error instanceof WorkflowAlreadyHandlesMessage
    ) {
      throw error
    }
    throw new WorkflowConfigurationFailed(
      workflowType.name,
      error,
      error instanceof WorkflowMappingInvalid ? error.help : undefined
    )
  }

  const workflowStateType = mapper.workflowStateCtor
  if (!workflowStateType) {
    throw new WorkflowStateNotProvided(workflowType.name)
  }
  return { mapper, workflowStateType }
}
