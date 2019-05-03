// tslint:disable:max-classes-per-file

import { Workflow, WorkflowData } from '../workflow'
import { injectable } from 'inversify'
import { TestCommand } from './test-command'
import { StartedBy } from '../workflow/decorators'

export class TestWorkflowStartedByDiscardData extends WorkflowData {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-discard'
  property1: string
}

/**
 * A test case where the workflow is completed in the StartedBy handler
 */
@injectable()
export class TestWorkflowStartedByDiscard extends Workflow<TestWorkflowStartedByDiscardData> {

  @StartedBy<TestCommand, TestWorkflowStartedByDiscardData, 'handleTestCommand'>(TestCommand)
  handleTestCommand (_: TestCommand): Partial<TestWorkflowStartedByDiscardData> {
    return this.discard()
  }
}
