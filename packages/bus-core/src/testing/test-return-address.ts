/**
 * The return address (`replyTo` attribute) that the test helpers give the message being handled unless the test
 * sets one. Replies recorded by `handlerContext()`, `workflowContext()` and `testWorkflow()` have it as their
 * `destination`, and `testWorkflow()` stamps it on the delayed messages it delivers, as a bus stamps its own queue.
 */
export const TEST_RETURN_ADDRESS = 'test-return-address'
