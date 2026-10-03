---
'@node-ts/bus-core': patch
---

**Breaking:** a failed workflow handler is now reported as a `WorkflowHandlerFailed`, which names the workflow, the instance's `$workflowId` and the message, and has the error the handler threw as its `cause` (#152). A failed `when` handler used to be logged inside a second `HandlerDispatchRejected`, repeating its message, and neither `when` nor `startedBy` failures named the workflow. The same error is used when the state a handler returned can't be saved. Code that inspected `HandlerDispatchRejected.rejections` for workflow failures should read `cause` instead.
