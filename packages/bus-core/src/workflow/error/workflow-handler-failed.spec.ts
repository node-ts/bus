import { WorkflowStateVersionConflict } from '../persistence'
import { WorkflowHandlerFailed } from './workflow-handler-failed'

describe('WorkflowHandlerFailed', () => {
  const workflowName = 'OrderWorkflow'
  const workflowId = '6f1d2c3b-0e4a-4f5b-9c8d-7a6b5c4d3e2f'
  const messageName = '@my-org/orders/order-shipped'

  describe('when a workflow handler threw an error', () => {
    const cause = new TypeError('orderId is undefined')
    let sut: WorkflowHandlerFailed

    beforeAll(() => {
      sut = new WorkflowHandlerFailed(
        workflowName,
        workflowId,
        messageName,
        cause
      )
    })

    it('should name the workflow, the instance, the message and the error', () => {
      expect(sut.message).toEqual(
        `Workflow OrderWorkflow failed handling @my-org/orders/order-shipped for workflow id ${workflowId}: TypeError: orderId is undefined`
      )
    })

    it('should set the error as the cause', () => {
      expect(sut.cause).toBe(cause)
    })

    it('should keep the cause enumerable so it is logged', () => {
      expect(Object.keys(sut)).toContain('cause')
    })

    it('should say how to fix it', () => {
      expect(sut.help).toContain('OrderWorkflow handler')
    })

    it('should be an instance of its class', () => {
      expect(sut).toBeInstanceOf(WorkflowHandlerFailed)
    })
  })

  describe('when the cause is an error class that does not set its name', () => {
    let sut: WorkflowHandlerFailed

    beforeAll(() => {
      sut = new WorkflowHandlerFailed(
        workflowName,
        workflowId,
        messageName,
        new WorkflowStateVersionConflict(workflowName, workflowId, 1, 2)
      )
    })

    it('should label the error with its class', () => {
      expect(sut.message).toContain(': WorkflowStateVersionConflict: ')
    })
  })

  describe('when the handler threw something other than an error', () => {
    let sut: WorkflowHandlerFailed

    beforeAll(() => {
      sut = new WorkflowHandlerFailed(
        workflowName,
        workflowId,
        messageName,
        'boom'
      )
    })

    it('should put it in the message', () => {
      expect(sut.message).toMatch(/: boom$/)
    })
  })
})
