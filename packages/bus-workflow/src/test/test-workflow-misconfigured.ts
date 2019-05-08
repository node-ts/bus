// tslint:disable:max-classes-per-file

import { Workflow, WorkflowData } from '../workflow'
import { injectable, inject } from 'inversify'
import { TestCommand } from './test-command'
import { StartedBy } from '../workflow/decorators'

export class TestWorkflowMisconfiguredData extends WorkflowData {
  $name = 'node-ts/bus/workflow/test-workflow-misconfigured'
  property1: string
}

/**
 * A test case where the workflow has dependencies that aren't registered with the IoC container
 */
@injectable()
export class TestWorkflowMisconfigured extends Workflow<TestWorkflowMisconfiguredData> {

  constructor (
    @inject(Symbol.for('TestWorkflowMisconfiguredFakeDependency')) readonly _: string
  ) {
    super()
  }

  @StartedBy<TestCommand, TestWorkflowMisconfiguredData, 'handleTestCommand'>(TestCommand)
  handleTestCommand (command: TestCommand): Partial<TestWorkflowMisconfiguredData> {
    return {
      property1: command.property1
    }
  }
}
