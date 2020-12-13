// tslint:disable:max-classes-per-file

import { Workflow, WorkflowData } from '../workflow'
import { injectable } from 'inversify'
import { TestCommand } from './test-command'
import { StartedBy } from '../workflow/decorators'

export class TestWorkflowStartedByCompletesData extends WorkflowData {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-completes'
  property1: string
}

/**
 * A test case where the workflow is completed in the StartedBy handler
 */
@injectable()
export class TestWorkflowStartedByCompletes extends Workflow<TestWorkflowStartedByCompletesData> {

  @StartedBy<TestCommand, TestWorkflowStartedByCompletesData, 'handleTestCommand'>(TestCommand)
  handleTestCommand (command: TestCommand): Partial<TestWorkflowStartedByCompletesData> {
    return this.complete({
      property1: command.property1
    })
  }
}
