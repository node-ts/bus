// tslint:disable:max-classes-per-file

import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'
import { WorkflowData } from '../workflow/workflow-data'
import { ClassConstructor } from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowStartedByMetadata } from '../workflow/decorators/started-by'
import { WorkflowHandlesMetadata } from '../workflow/decorators/handles'
import { MessageWorkflowMapping } from '../workflow/message-workflow-mapping'

class TestWorkflowFnData extends WorkflowData {
  $name = 'TestWorkflowFnData'
  property1: string
}

class AnotherWorkflowData extends WorkflowData {
  $name = 'TestWorkflowFnData'
  property2: string
}

interface WorkflowHandlingContext<TMessage extends Message, TWorkflowData extends WorkflowData = undefined> {
  message: TMessage
  data: TWorkflowData
}

type HandlerFor<TMessage extends Message, TWorkflowData extends WorkflowData = undefined> = (
  context: WorkflowHandlingContext<TMessage, TWorkflowData>
) => void | Promise<Partial<WorkflowData>>

class Workflow<TWorkflowData extends WorkflowData> {

  private constructor (
    readonly name: string,
    readonly workflowData?: ClassConstructor<TWorkflowData>
  ) {
  }

  static define<TWorkflowData extends WorkflowData = undefined> (
    name: string,
    workflowData?: ClassConstructor<TWorkflowData>
  ): Workflow<TWorkflowData> {
    return new Workflow(name, workflowData)
  }

  isStartedBy<TMessage extends Message> (
    message: ClassConstructor<TMessage>,
    handler: HandlerFor<TMessage, TWorkflowData>
  ): this {
    return this
  }

  handles<TMessage extends Message> (
    messageConstructor: ClassConstructor<TMessage>,
    handler: HandlerFor<TMessage, TWorkflowData>,
    workflowDataProperty: keyof TWorkflowData & string,
    messageLookup: (message: TMessage, messageOptions: MessageAttributes) => string | undefined
  ): this {
    WorkflowHandlesMetadata.addStep(
      {
        workflowDataProperty,
        messageConstructor,
        messageWorkflowMapping: new MessageWorkflowMapping(messageLookup, workflowDataProperty)
      },
      target
    )
    return this
  }
}

const handleTestCommand = async (
  { message }: WorkflowHandlingContext<TestCommand>
): Promise<Partial<TestWorkflowFnData>> => {
  await bus.send(new RunTask(message.property1!))
  return {
    property1: message.property1
  }
}

const handleTaskRan = async (
  _: WorkflowHandlingContext<TaskRan, TestWorkflowFnData>
): Promise<Partial<TestWorkflowFnData>> => {
  return {}
}

const handleFinalTask = async (
  _: WorkflowHandlingContext<FinalTask, TestWorkflowFnData>
): Promise<Partial<TestWorkflowFnData>> => {
  return {}
}

// TODO register this with bus somewhere central, OR do startup discovery by convention
export const testWorkflowFn = Workflow
  .define('testWorkflowFn', TestWorkflowFnData)
  .isStartedBy(TestCommand, handleTestCommand)
  .isStartedBy(TestCommand, handleTestCommand)
  .handles(TaskRan, handleTaskRan, '$workflowId', (_, messageOptions) => messageOptions.correlationId)
  .handles(FinalTask, handleFinalTask, '$workflowId', (_, messageOptions) => messageOptions.correlationId)
