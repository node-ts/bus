import { FinalTask } from '../workflow/test/final-task'
import { RunTask } from '../workflow/test/run-task'
import { TaskRan } from '../workflow/test/task-ran'
import { TestDiscardedWorkflowState } from '../workflow/test/test-discarded-workflow'
import { TestFunctionWorkflowState } from '../workflow/test/test-function-workflow'
import {
  TestFunctionStartedByCompletesState,
  TestFunctionStartedByCopyState,
  TestFunctionStartedByDiscardState,
  TestFunctionStartedByVoidState
} from '../workflow/test/test-function-workflow-started-by'
import {
  TestReplyingClassWorkflowState,
  TestReplyingWorkflowState
} from '../workflow/test/test-replying-workflow'
import { TestRequestReplyWorkflowState } from '../workflow/test/test-request-reply-workflow'
import {
  StartTestTimeoutWorkflow,
  TestFunctionTimeoutWorkflowState,
  TestPaymentReceived,
  TestPaymentTimedOut,
  TestTimeoutWorkflowState
} from '../workflow/test/test-timeout-workflow'
import { TestVoidStartedByWorkflowState } from '../workflow/test/test-void-startedby-workflow'
import { TestWorkflowStartedByCompletesData } from '../workflow/test/test-workflow-startedby-completes'
import { TestWorkflowStartedByDiscardData } from '../workflow/test/test-workflow-startedby-discard'
import { TestWorkflowState } from '../workflow/test/test-workflow-state'
import { messageTypesFor } from './message-types-for'
import { TestCommand } from './test-command'
import { TestCommand2 } from './test-command-2'
import { TestCommand3 } from './test-command-3'
import { TestDefinedCommand } from './test-defined-command'
import { TestDefinedEvent } from './test-defined-event'
import { TestEvent } from './test-event'
import { TestEvent2 } from './test-event-2'
import { TestFailMessage } from './test-fail-message'

/**
 * Message types for the messages and workflow state in bus-core's test fixtures
 */
export const testMessageTypes = messageTypesFor(
  TestCommand,
  TestCommand2,
  TestCommand3,
  TestDefinedCommand,
  TestDefinedEvent,
  TestEvent,
  TestEvent2,
  TestFailMessage,
  RunTask,
  TaskRan,
  FinalTask,
  TestDiscardedWorkflowState,
  TestVoidStartedByWorkflowState,
  new TestWorkflowStartedByCompletesData().$name,
  new TestWorkflowStartedByDiscardData().$name,
  TestWorkflowState,
  TestFunctionWorkflowState,
  TestFunctionStartedByCompletesState,
  TestFunctionStartedByCopyState,
  TestFunctionStartedByDiscardState,
  TestFunctionStartedByVoidState,
  TestRequestReplyWorkflowState,
  TestReplyingWorkflowState,
  TestReplyingClassWorkflowState,
  StartTestTimeoutWorkflow,
  TestPaymentReceived,
  TestPaymentTimedOut,
  TestTimeoutWorkflowState,
  TestFunctionTimeoutWorkflowState
)
