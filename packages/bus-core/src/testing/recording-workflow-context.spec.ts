import { messageAttributes } from '@node-ts/bus-messages'
import { InvalidDeliveryOptions } from '../outgoing-message'
import {
  StartTestTimeoutWorkflow,
  testFunctionTimeoutWorkflow,
  TestFunctionTimeoutWorkflowState,
  TestPaymentReceived,
  TestPaymentTimedOut
} from '../workflow/test/test-timeout-workflow'
import { WorkflowStatus } from '../workflow/workflow-state'
import {
  RecordingWorkflowContext,
  workflowContext
} from './recording-workflow-context'
import { TEST_RETURN_ADDRESS } from './test-return-address'

const runningState = (): TestFunctionTimeoutWorkflowState =>
  Object.assign(new TestFunctionTimeoutWorkflowState(), {
    $workflowId: 'workflow-1',
    $status: WorkflowStatus.Running,
    $version: 1
  })

describe('workflowContext', () => {
  describe('when a startedBy handler of a workflow declared with defineWorkflow is called with it', () => {
    const sut = workflowContext<TestFunctionTimeoutWorkflowState>()

    beforeAll(async () => {
      await testFunctionTimeoutWorkflow.startedByHandler(
        StartTestTimeoutWorkflow
      )(
        StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: 30_000 }),
        runningState(),
        sut
      )
    })

    it('should record what it sent with its delivery options', () => {
      expect(sut.sent).toEqual([
        {
          message: TestPaymentTimedOut({ orderId: '1' }),
          options: { deliverAfter: 30_000 }
        }
      ])
    })

    it('should not record that the workflow ended', () => {
      expect(sut.completed).toEqual(false)
      expect(sut.discarded).toEqual(false)
    })
  })

  describe('when a handler completes the workflow', () => {
    const sut = workflowContext<TestFunctionTimeoutWorkflowState>()
    let result: unknown

    beforeAll(async () => {
      result = await testFunctionTimeoutWorkflow.whenHandler(
        TestPaymentReceived
      )(TestPaymentReceived({ orderId: '1' }), runningState(), sut)
    })

    it('should record it', () => {
      expect(sut.completed).toEqual(true)
    })

    it('should return the changes with the complete status', () => {
      expect(result).toEqual({ paid: true, $status: WorkflowStatus.Complete })
    })
  })

  describe('when discarding, failing and returning the message', () => {
    const sut = workflowContext<TestFunctionTimeoutWorkflowState>()
    let discarded: unknown

    beforeAll(async () => {
      discarded = sut.discard()
      await sut.failMessage()
      await sut.returnMessage()
      await sut.reply(TestPaymentReceived({ orderId: '1' }))
    })

    it('should record each', () => {
      expect(sut.discarded).toEqual(true)
      expect(sut.messageFailed).toEqual(true)
      expect(sut.messageReturned).toEqual(true)
      expect(sut.replied).toEqual([
        {
          message: TestPaymentReceived({ orderId: '1' }),
          options: {},
          destination: TEST_RETURN_ADDRESS
        }
      ])
    })

    it('should return the discard status', () => {
      expect(discarded).toEqual({ $status: WorkflowStatus.Discard })
    })
  })

  describe('when created with attributes', () => {
    const attributes = messageAttributes({ attributes: { tenantId: 't' } })
    const sut = workflowContext<TestFunctionTimeoutWorkflowState>({
      attributes,
      correlationId: 'correlation-1'
    })

    it('should use them', () => {
      expect(sut.attributes).toBe(attributes)
      expect(sut.correlationId).toEqual('correlation-1')
    })
  })

  describe('when created with attributes that have a correlation id and return address', () => {
    let sut: RecordingWorkflowContext<TestFunctionTimeoutWorkflowState>

    beforeAll(async () => {
      sut = workflowContext<TestFunctionTimeoutWorkflowState>({
        attributes: messageAttributes({
          correlationId: 'from-attributes',
          replyTo: 'requester'
        })
      })
      await sut.reply(TestPaymentReceived({ orderId: '1' }))
    })

    it('should take the correlation id from them', () => {
      expect(sut.correlationId).toEqual('from-attributes')
    })

    it('should record replies to their return address', () => {
      expect(sut.replied[0].destination).toEqual('requester')
    })
  })

  describe('when a handler sends with an invalid deliverAfter', () => {
    let error: unknown

    beforeAll(async () => {
      error = await testFunctionTimeoutWorkflow
        .startedByHandler(StartTestTimeoutWorkflow)(
          StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: NaN }),
          runningState(),
          workflowContext<TestFunctionTimeoutWorkflowState>()
        )
        .catch((e: unknown) => e)
    })

    it('should throw InvalidDeliveryOptions, as the bus does', () => {
      expect(error).toBeInstanceOf(InvalidDeliveryOptions)
    })
  })
})
