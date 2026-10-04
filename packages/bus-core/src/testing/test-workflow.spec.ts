import { ReturnAddressMissing } from '../error'
import { InvalidDeliveryOptions } from '../outgoing-message'
import { WorkflowStateNotProvided } from '../workflow'
import { TestCommand } from '../workflow/test/test-command'
import { TestDiscardedWorkflow } from '../workflow/test/test-discarded-workflow'
import {
  StartTestFailingWorkflow,
  StartTestFunctionFailingWorkflow,
  TestFailingWorkflow,
  testFunctionFailingWorkflow
} from '../workflow/test/test-failing-workflow'
import {
  testFunctionStartedByCopyWorkflow,
  testFunctionStartedByDiscardWorkflow
} from '../workflow/test/test-function-workflow-started-by'
import {
  StartTestScenario,
  TestScenarioClassWorkflow,
  TestScenarioItemAdded,
  TestScenarioStarted,
  TestScenarioState,
  TestScenarioTimedOut,
  testScenarioWorkflow
} from '../workflow/test/test-scenario-workflow'
import {
  StartTestSettlingWorkflow,
  testFunctionSettlingWorkflow,
  TestSettlingWorkflow
} from '../workflow/test/test-settling-workflow'
import {
  StartTestTimeoutWorkflow,
  testFunctionTimeoutWorkflow,
  TestPaymentReceived,
  TestPaymentTimedOut,
  TestTimeoutWorkflow
} from '../workflow/test/test-timeout-workflow'
import { Workflow, WorkflowMapper } from '../workflow/workflow'
import { WorkflowState, WorkflowStatus } from '../workflow/workflow-state'
import {
  InvalidTimeAdvance,
  MessageNotHandledByWorkflow,
  WorkflowFactoryMissing
} from './error'
import { TEST_RETURN_ADDRESS } from './test-return-address'
import { testWorkflow } from './test-workflow'
import { WorkflowScenario } from './workflow-scenario'
import { WorkflowScenarioOptions } from './workflow-scenario-options'
import { WorkflowScenarioResult } from './workflow-scenario-result'

/**
 * The fields of both timeout workflows' states
 */
interface TimeoutState extends WorkflowState {
  orderId: string
  paid: boolean
  timedOutOrderId: string | undefined
}

const START_TIME = new Date('2030-01-01T00:00:00Z')

const timeoutWorkflows: [
  string,
  (
    options?: WorkflowScenarioOptions<TimeoutState>
  ) => WorkflowScenario<TimeoutState>
][] = [
  ['a class workflow', options => testWorkflow(TestTimeoutWorkflow, options)],
  [
    'a workflow declared with defineWorkflow',
    options => testWorkflow(testFunctionTimeoutWorkflow, options)
  ]
]

describe('testWorkflow', () => {
  describe.each(timeoutWorkflows)('with %s', (_, createScenario) => {
    describe('when the workflow is started', () => {
      let sut: WorkflowScenario<TimeoutState>
      let result: WorkflowScenarioResult<TimeoutState>

      beforeEach(async () => {
        sut = createScenario({ now: START_TIME })
        result = await sut.when(
          StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: 1_000 }),
          { correlationId: 'correlation-1' }
        )
      })

      it('should handle the message', () => {
        expect(result.handled).toEqual(true)
        expect(result.discarded).toEqual(false)
      })

      it('should save the new state as running, with one save counted', () => {
        expect(result.status).toEqual(WorkflowStatus.Running)
        expect(result.state).toMatchObject({
          orderId: '1',
          paid: false,
          $status: WorkflowStatus.Running,
          $version: 1
        })
        expect(result.state!.$workflowId).toEqual(expect.any(String))
        expect(sut.state).toBe(result.state)
      })

      it('should record the timeout it sent with its options', () => {
        expect(result.sent).toEqual([
          {
            message: TestPaymentTimedOut({ orderId: '1' }),
            options: { deliverAfter: 1_000 }
          }
        ])
        expect(result.published).toEqual([])
        expect(result.replied).toEqual([])
      })

      it('should schedule the timeout on the scenario clock', () => {
        expect(sut.scheduled).toEqual([
          {
            message: TestPaymentTimedOut({ orderId: '1' }),
            options: { deliverAfter: 1_000 },
            dueAt: new Date(START_TIME.getTime() + 1_000)
          }
        ])
      })

      it('should freeze the saved state', () => {
        expect(Object.isFrozen(result.state)).toEqual(true)
      })

      describe('and a message maps to it with its custom lookup', () => {
        let continued: WorkflowScenarioResult<TimeoutState>

        beforeEach(async () => {
          continued = await sut.when(TestPaymentReceived({ orderId: '1' }))
        })

        it('should complete the workflow, keeping its id and counting the save', () => {
          expect(continued.handled).toEqual(true)
          expect(continued.status).toEqual(WorkflowStatus.Complete)
          expect(continued.state).toMatchObject({
            $workflowId: result.state!.$workflowId,
            $version: 2,
            orderId: '1',
            paid: true
          })
        })

        describe('and then the timeout falls due', () => {
          let timedOut: WorkflowScenarioResult<TimeoutState>[]

          beforeEach(async () => {
            timedOut = await sut.advanceTime(1_000)
          })

          it('should deliver it without handling it, since the workflow completed', () => {
            expect(timedOut).toHaveLength(1)
            expect(timedOut[0].handled).toEqual(false)
            expect(timedOut[0].state).toMatchObject({ paid: true, $version: 2 })
          })
        })
      })

      describe('and a message whose custom lookup maps to another instance', () => {
        let unmatched: WorkflowScenarioResult<TimeoutState>

        beforeEach(async () => {
          unmatched = await sut.when(TestPaymentReceived({ orderId: '2' }))
        })

        it('should not handle it', () => {
          expect(unmatched.handled).toEqual(false)
          expect(unmatched.state).toBe(result.state)
        })
      })

      describe('and the time until the timeout passes', () => {
        let timedOut: WorkflowScenarioResult<TimeoutState>[]

        beforeEach(async () => {
          timedOut = await sut.advanceTime(1_000)
        })

        it('should deliver the timeout to the instance that sent it', () => {
          expect(timedOut).toHaveLength(1)
          expect(timedOut[0]).toMatchObject({
            message: TestPaymentTimedOut({ orderId: '1' }),
            handled: true,
            status: WorkflowStatus.Complete,
            state: { timedOutOrderId: '1', paid: false, $version: 2 }
          })
        })

        it('should leave nothing scheduled', () => {
          expect(sut.scheduled).toEqual([])
        })

        it('should move the clock on', () => {
          expect(sut.now).toEqual(new Date(START_TIME.getTime() + 1_000))
        })
      })

      describe('and less time than the timeout passes', () => {
        let timedOut: WorkflowScenarioResult<TimeoutState>[]

        beforeEach(async () => {
          timedOut = await sut.advanceTime(999)
        })

        it('should deliver nothing', () => {
          expect(timedOut).toEqual([])
          expect(sut.scheduled).toHaveLength(1)
          expect(sut.state!.$status).toEqual(WorkflowStatus.Running)
        })
      })
    })

    describe('when given a state', () => {
      let sut: WorkflowScenario<TimeoutState>

      beforeEach(() => {
        sut = createScenario().given({ orderId: '2', paid: false })
      })

      it('should fill in the fields the bus manages', () => {
        expect(sut.state).toMatchObject({
          orderId: '2',
          $status: WorkflowStatus.Running,
          $version: 1,
          $workflowId: expect.any(String)
        })
      })

      describe('and a message mapped by the workflow id', () => {
        let result: WorkflowScenarioResult<TimeoutState>

        beforeEach(async () => {
          result = await sut.when(TestPaymentTimedOut({ orderId: '2' }))
        })

        it('should give it the instance workflow id and handle it', () => {
          expect(result.handled).toEqual(true)
          expect(result.status).toEqual(WorkflowStatus.Complete)
          expect(result.state).toMatchObject({ timedOutOrderId: '2' })
        })
      })

      describe('and a message with the workflow id of another instance', () => {
        let result: WorkflowScenarioResult<TimeoutState>

        beforeEach(async () => {
          result = await sut.when(TestPaymentTimedOut({ orderId: '2' }), {
            stickyAttributes: { workflowId: 'another-instance' }
          })
        })

        it('should not handle it', () => {
          expect(result.handled).toEqual(false)
          expect(result.status).toEqual(WorkflowStatus.Running)
        })
      })
    })

    describe('when given a message the workflow does not handle', () => {
      it('should throw MessageNotHandledByWorkflow', async () => {
        await expect(
          createScenario().when(new TestCommand('1'))
        ).rejects.toBeInstanceOf(MessageNotHandledByWorkflow)
      })
    })

    describe('when advancing the time by a negative number', () => {
      it('should throw InvalidTimeAdvance', async () => {
        await expect(createScenario().advanceTime(-1)).rejects.toBeInstanceOf(
          InvalidTimeAdvance
        )
      })
    })

    describe('with a context member', () => {
      let correlationIds: (string | undefined)[]

      beforeEach(async () => {
        correlationIds = []
        const sut = createScenario({
          context: {
            correlationId: 'from-options',
            send: async (_command, _options) => {
              correlationIds.push('sent')
            }
          }
        })
        await sut.when(StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: 1 }))
      })

      it('should call the handlers with it', () => {
        expect(correlationIds).toEqual(['sent'])
      })
    })
  })

  describe.each([
    ['a class workflow', testWorkflow(TestDiscardedWorkflow)],
    [
      'a workflow declared with defineWorkflow',
      testWorkflow(testFunctionStartedByDiscardWorkflow)
    ]
  ] as [string, WorkflowScenario<WorkflowState>][])(
    'when the startedBy handler of %s discards the workflow',
    (_, sut) => {
      let result: WorkflowScenarioResult<WorkflowState>

      beforeAll(async () => {
        result = await sut.when(new TestCommand('1'))
      })

      it('should not start an instance', () => {
        expect(result.handled).toEqual(true)
        expect(result.discarded).toEqual(true)
        expect(result.state).toBeUndefined()
        expect(sut.state).toBeUndefined()
      })
    }
  )

  describe.each([
    ['a class workflow', 'fail', testWorkflow(TestSettlingWorkflow)],
    ['a class workflow', 'return', testWorkflow(TestSettlingWorkflow)],
    [
      'a workflow declared with defineWorkflow',
      'fail',
      testWorkflow(testFunctionSettlingWorkflow)
    ],
    [
      'a workflow declared with defineWorkflow',
      'return',
      testWorkflow(testFunctionSettlingWorkflow)
    ]
  ] as [string, 'fail' | 'return', WorkflowScenario<WorkflowState>][])(
    'when a handler of %s calls %sMessage',
    (_, settle, sut) => {
      let result: WorkflowScenarioResult<WorkflowState>

      beforeAll(async () => {
        result = await sut.when(
          StartTestSettlingWorkflow({ orderId: '1', settle })
        )
      })

      it('should record it', () => {
        expect(result.messageFailed).toEqual(settle === 'fail')
        expect(result.messageReturned).toEqual(settle === 'return')
      })

      it('should not save the state', () => {
        expect(result.state).toBeUndefined()
      })

      it('should drop what it sent, and schedule nothing', () => {
        expect(result.sent).toEqual([])
        expect(sut.scheduled).toEqual([])
      })
    }
  )

  describe.each([
    [
      'a class workflow',
      testWorkflow(TestFailingWorkflow),
      StartTestFailingWorkflow({ key: 'a', fail: true })
    ],
    [
      'a workflow declared with defineWorkflow',
      testWorkflow(testFunctionFailingWorkflow),
      StartTestFunctionFailingWorkflow({ key: 'a', fail: true })
    ]
  ] as [string, WorkflowScenario<WorkflowState>, StartTestFailingWorkflow][])(
    'when a handler of %s throws',
    (_, sut, message) => {
      it('should reject with its error and save nothing', async () => {
        await expect(sut.when(message)).rejects.toThrow(
          /startedBy failed for a/
        )
        expect(sut.state).toBeUndefined()
      })
    }
  )

  describe('when a handler returns other values for the fields the bus manages', () => {
    let result: WorkflowScenarioResult<WorkflowState>

    beforeAll(async () => {
      result = await testWorkflow(testFunctionStartedByCopyWorkflow).when(
        new TestCommand('value')
      )
    })

    it('should keep the ones the bus set', () => {
      expect(result.state).toMatchObject({
        property1: 'value',
        $version: 1,
        $name: '@node-ts/bus-core/test-function-started-by-copy-state'
      })
      expect(result.state!.$workflowId).not.toEqual('not-the-workflow-id')
    })
  })

  describe('when a class workflow is created by createWorkflow', () => {
    let created: number

    beforeAll(async () => {
      created = 0
      const sut = testWorkflow(TestTimeoutWorkflow, {
        createWorkflow: () => {
          created++
          return new TestTimeoutWorkflow()
        }
      })
      await sut.when(StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: 1 }))
      await sut.when(TestPaymentReceived({ orderId: '1' }))
    })

    it('should create one to configure it and one for each message', () => {
      expect(created).toEqual(3)
    })
  })

  describe('when a class workflow does not declare its state', () => {
    class StatelessWorkflowState extends WorkflowState {
      $name = 'stateless'
    }
    class StatelessWorkflow extends Workflow<StatelessWorkflowState> {
      configureWorkflow(
        _mapper: WorkflowMapper<StatelessWorkflowState, StatelessWorkflow>
      ): void {}
    }

    it('should throw WorkflowStateNotProvided', () => {
      expect(() => testWorkflow(StatelessWorkflow)).toThrow(
        WorkflowStateNotProvided
      )
    })
  })

  describe('when a handler replies', () => {
    let result: WorkflowScenarioResult<TestScenarioState>

    beforeAll(async () => {
      result = await testWorkflow(testScenarioWorkflow).when(
        StartTestScenario({ orderNumber: 1, timeoutOutcome: 'complete' })
      )
    })

    it('should record the reply to the test return address', () => {
      expect(result.replied).toEqual([
        {
          message: TestScenarioStarted({ orderNumber: 1 }),
          options: {},
          destination: TEST_RETURN_ADDRESS
        }
      ])
    })

    it('should narrow the recorded messages by type', () => {
      expect(
        result.repliedOf(TestScenarioStarted)[0].message.orderNumber
      ).toEqual(1)
      expect(result.sentOf(TestScenarioTimedOut)[0].message.outcome).toEqual(
        'complete'
      )
      expect(result.sentOf(TestCommand)).toEqual([])
    })

    describe('and the message has a return address', () => {
      let replied: WorkflowScenarioResult<TestScenarioState>

      beforeAll(async () => {
        replied = await testWorkflow(testScenarioWorkflow).when(
          StartTestScenario({ orderNumber: 1, timeoutOutcome: 'complete' }),
          { replyTo: 'requester' }
        )
      })

      it('should record the reply to it', () => {
        expect(replied.replied[0].destination).toEqual('requester')
      })
    })
  })

  describe('when a handler replies to a message without a return address', () => {
    it('should throw ReturnAddressMissing naming the message', async () => {
      await expect(
        testWorkflow(testScenarioWorkflow).when(
          StartTestScenario({ orderNumber: 1, timeoutOutcome: 'complete' }),
          { replyTo: undefined }
        )
      ).rejects.toMatchObject({
        constructor: ReturnAddressMissing,
        messageName: StartTestScenario.NAME,
        replyName: TestScenarioStarted.NAME
      })
    })
  })

  describe('when a custom mapping looks up 0', () => {
    let result: WorkflowScenarioResult<TestScenarioState>

    beforeAll(async () => {
      const sut = testWorkflow(testScenarioWorkflow)
      await sut.when(
        StartTestScenario({ orderNumber: 0, timeoutOutcome: 'complete' })
      )
      result = await sut.when(TestScenarioItemAdded({ orderNumber: 0 }))
    })

    it('should map the message to the instance, as the persistence does', () => {
      expect(result.handled).toEqual(true)
      expect(result.state).toMatchObject({ items: 1 })
    })
  })

  describe('when a timeout is delivered', () => {
    let sut: WorkflowScenario<TestScenarioState>
    let result: WorkflowScenarioResult<TestScenarioState>

    beforeAll(async () => {
      sut = testWorkflow(testScenarioWorkflow)
      await sut.when(
        StartTestScenario({ orderNumber: 1, timeoutOutcome: 'complete' })
      )
      ;[result] = await sut.advanceTime(1_000)
    })

    it('should give it a correlation id and the return address, as the bus does', () => {
      expect(result.state).toMatchObject({
        timeoutCorrelationId: expect.any(String),
        timeoutReplyTo: TEST_RETURN_ADDRESS
      })
    })
  })

  describe('when a timeout handler throws', () => {
    let sut: WorkflowScenario<TestScenarioState>
    let error: unknown

    beforeAll(async () => {
      sut = testWorkflow(testScenarioWorkflow, { now: START_TIME })
      await sut.when(
        StartTestScenario({ orderNumber: 1, timeoutOutcome: 'throw' })
      )
      error = await sut.advanceTime(5_000).catch((e: unknown) => e)
    })

    it('should reject with its error', () => {
      expect(error).toMatchObject({ message: 'The timeout failed' })
    })

    it('should keep the timeout scheduled, and stop the clock when it was due', () => {
      expect(sut.scheduled).toHaveLength(1)
      expect(sut.now).toEqual(new Date(START_TIME.getTime() + 1_000))
    })
  })

  describe('when a timeout handler fails the message and then throws', () => {
    let sut: WorkflowScenario<TestScenarioState>
    let error: unknown
    let later: WorkflowScenarioResult<TestScenarioState>[]

    beforeAll(async () => {
      sut = testWorkflow(testScenarioWorkflow)
      await sut.when(
        StartTestScenario({ orderNumber: 1, timeoutOutcome: 'failThenThrow' })
      )
      error = await sut.advanceTime(1_000).catch((e: unknown) => e)
      later = await sut.advanceTime(1_000)
    })

    it('should reject with its error', () => {
      expect(error).toMatchObject({
        message: 'The timeout was failed, then threw'
      })
    })

    it('should not schedule it again, since the bus dead-letters it', () => {
      expect(sut.scheduled).toEqual([])
      expect(later).toEqual([])
    })
  })

  describe('when a timeout handler returns the message', () => {
    let sut: WorkflowScenario<TestScenarioState>
    let first: WorkflowScenarioResult<TestScenarioState>[]
    let second: WorkflowScenarioResult<TestScenarioState>[]

    beforeAll(async () => {
      sut = testWorkflow(testScenarioWorkflow)
      await sut.when(
        StartTestScenario({ orderNumber: 1, timeoutOutcome: 'return' })
      )
      first = await sut.advanceTime(1_000)
      second = await sut.advanceTime(0)
    })

    it('should deliver it once each time the clock moves', () => {
      expect(first).toHaveLength(1)
      expect(first[0].messageReturned).toEqual(true)
      expect(second).toHaveLength(1)
    })

    it('should keep it scheduled for the next retry', () => {
      expect(sut.scheduled).toHaveLength(1)
    })
  })

  describe('when a class workflow has constructor arguments', () => {
    describe('without createWorkflow', () => {
      it('should throw WorkflowFactoryMissing', () => {
        expect(() => testWorkflow(TestScenarioClassWorkflow)).toThrow(
          WorkflowFactoryMissing
        )
      })
    })

    describe('with createWorkflow', () => {
      let result: WorkflowScenarioResult<TestScenarioState>

      beforeAll(async () => {
        result = await testWorkflow(TestScenarioClassWorkflow, {
          createWorkflow: () =>
            new TestScenarioClassWorkflow({ next: () => 42 })
        }).when(
          StartTestScenario({ orderNumber: 1, timeoutOutcome: 'complete' })
        )
      })

      it('should use it', () => {
        expect(result.state).toMatchObject({ orderNumber: 42 })
      })
    })
  })

  describe('when a handler sends with invalid delivery options', () => {
    it('should throw InvalidDeliveryOptions, as the bus does', async () => {
      await expect(
        testWorkflow(TestTimeoutWorkflow).when(
          StartTestTimeoutWorkflow({ orderId: '1', timeoutMs: -1 })
        )
      ).rejects.toBeInstanceOf(InvalidDeliveryOptions)
    })
  })
})
