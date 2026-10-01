import {
  Bus,
  BusInstance,
  Logger,
  Persistence,
  Workflow,
  WorkflowMapper
} from '@node-ts/bus-core'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import {
  messageTypes,
  TestAddress,
  TestContinueRoundTripWorkflow,
  TestCustomer,
  TestGeoPoint,
  TestRoundTripWorkflowState,
  TestStartRoundTripWorkflow
} from './helpers'
import { createTestRoundTripCommand } from './message-round-trip-cases'

/**
 * A suite that starts a workflow whose state has nested types (Dates, class instances several
 * levels deep and arrays of Dates), then checks the state the next handler reads back from the
 * persistence has its types restored.
 * @param persistence A fully configured persistence that's the subject under test. It's disposed when
 * the suite's bus is disposed, unless another bus that uses it is still running.
 */
export const workflowStateRoundTripTests = (persistence: Persistence): void => {
  const events = new EventEmitter()
  let readState: TestRoundTripWorkflowState | undefined
  let bus: BusInstance

  class TestRoundTripWorkflow extends Workflow<TestRoundTripWorkflowState> {
    configureWorkflow(
      mapper: WorkflowMapper<TestRoundTripWorkflowState, TestRoundTripWorkflow>
    ): void {
      mapper
        .withState(TestRoundTripWorkflowState)
        .startedBy(TestStartRoundTripWorkflow, 'start')
        .when(TestContinueRoundTripWorkflow, 'continue', {
          lookup: message => message.orderId,
          mapsTo: 'orderId'
        })
    }

    start({
      orderId,
      startedAt,
      customer
    }: TestStartRoundTripWorkflow): Partial<TestRoundTripWorkflowState> {
      events.emit('started')
      return { orderId, startedAt, customer, checkpoints: [startedAt] }
    }

    continue(
      _: TestContinueRoundTripWorkflow,
      state: TestRoundTripWorkflowState
    ): Partial<TestRoundTripWorkflowState> {
      readState = state
      events.emit('continued')
      return this.completeWorkflow()
    }
  }

  describe('when workflow state makes a round trip through the persistence', () => {
    const { customer } = createTestRoundTripCommand()
    const start = Object.assign(new TestStartRoundTripWorkflow(), {
      orderId: randomUUID(),
      startedAt: new Date('2022-06-07T08:09:10.011Z'),
      customer
    })
    let state: TestRoundTripWorkflowState

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(messageTypes)
        .withPersistence(persistence)
        .withWorkflow(TestRoundTripWorkflow)
        .build()
      await bus.initialize()
      await bus.start()

      // The bus handles one message at a time, so the state is saved before the next one is read
      const started = new Promise(resolve => events.once('started', resolve))
      const continued = new Promise(resolve =>
        events.once('continued', resolve)
      )
      await bus.send(start)
      await started
      await bus.send(
        Object.assign(new TestContinueRoundTripWorkflow(), {
          orderId: start.orderId
        })
      )
      await continued
      state = readState!
    })

    afterAll(async () => bus.dispose())

    it('should read back plain fields', () => {
      expect(state.orderId).toEqual(start.orderId)
      expect(state.$name).toEqual(TestRoundTripWorkflowState.NAME)
    })

    it('should restore a Date field', () => {
      expect(state.startedAt).toBeInstanceOf(Date)
      expect(state.startedAt.getTime()).toEqual(start.startedAt.getTime())
    })

    it('should restore nested class instances several levels deep', () => {
      expect(state.customer).toBeInstanceOf(TestCustomer)
      expect(state.customer.joinedAt).toBeInstanceOf(Date)
      expect(state.customer.address).toBeInstanceOf(TestAddress)
      expect(state.customer.address.location).toBeInstanceOf(TestGeoPoint)
      expect(state.customer.address.location.surveyedAt).toBeInstanceOf(Date)
      expect(state.customer.address.location.coordinates).toEqual(
        customer.address.location.coordinates
      )
      expect(state.customer.previousAddresses[0]).toBeInstanceOf(TestAddress)
    })

    it('should restore arrays of Dates', () => {
      expect(state.checkpoints).toHaveLength(1)
      expect(state.checkpoints[0]).toBeInstanceOf(Date)
      expect(state.checkpoints[0].getTime()).toEqual(start.startedAt.getTime())
    })
  })
}
