import {
  Command,
  defineCommand,
  Event,
  MessageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { Workflow, WorkflowHandler, WorkflowMapper } from './workflow'
import { WorkflowState } from './workflow-state'
import {
  WorkflowHandlerResult,
  WorkflowStateChange
} from './workflow-state-change'

class OrderState extends WorkflowState {
  static NAME = '@node-ts/bus-core/workflow-types-spec-order-state'
  $name = OrderState.NAME

  orderId: string
  total: number
  charged: boolean
  customer: { name: string }
}

class OtherState extends WorkflowState {
  static NAME = '@node-ts/bus-core/workflow-types-spec-other-state'
  $name = OtherState.NAME

  otherId: string
}

class OrderPlaced extends Command {
  static NAME = '@node-ts/bus-core/workflow-types-spec-order-placed'
  $name = OrderPlaced.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly total: number
  ) {
    super()
  }
}

class CardCharged extends Event {
  static NAME = '@node-ts/bus-core/workflow-types-spec-card-charged'
  $name = CardCharged.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly amount: number
  ) {
    super()
  }
}

const OrderCancelled = defineCommand(
  '@node-ts/bus-core/workflow-types-spec-order-cancelled'
)<{ orderId: string }>()
type OrderCancelled = MessageOf<typeof OrderCancelled>

class OrderWorkflow extends Workflow<OrderState> {
  readonly label = 'not a handler'

  configureWorkflow(mapper: WorkflowMapper<OrderState, OrderWorkflow>): void {
    mapper
      .withState(OrderState)
      .startedBy(OrderPlaced, 'start')
      .when(CardCharged, 'charged', {
        lookup: message => message.orderId,
        mapsTo: 'orderId'
      })
      .when(OrderCancelled, 'cancelled')
  }

  // Valid handlers

  start(message: OrderPlaced) {
    return { orderId: message.orderId }
  }

  async startAsync(
    message: OrderPlaced,
    _state: OrderState,
    _attributes: MessageAttributes,
    _ctx: HandlerContext
  ) {
    return { orderId: message.orderId }
  }

  startUnion(message: OrderPlaced) {
    return message.total > 1 ? { orderId: message.orderId } : { total: 1 }
  }

  startExplicit(message: OrderPlaced): Partial<OrderState> {
    return { orderId: message.orderId }
  }

  async startExplicitAsync(
    message: OrderPlaced
  ): Promise<WorkflowStateChange<OrderState>> {
    return { orderId: message.orderId }
  }

  startResult({ orderId }: OrderPlaced): WorkflowHandlerResult<OrderState> {
    return { orderId }
  }

  startTypedAttributes(
    _message: OrderPlaced,
    _state: OrderState,
    attributes: MessageAttributes<{ tenant: string }>
  ) {
    return { orderId: attributes.attributes.tenant }
  }

  charged(message: CardCharged, state: OrderState) {
    return { ...state, total: message.amount, charged: true }
  }

  chargedOrCancelled(message: CardCharged | OrderCancelled) {
    return { orderId: message.orderId }
  }

  cancelled(_message: OrderCancelled, state: Readonly<OrderState>) {
    return state.charged ? this.discardWorkflow() : this.completeWorkflow()
  }

  noArguments() {
    return this.completeWorkflow({ charged: true })
  }

  async nothing() {}

  // Invalid handlers

  wrongField(message: OrderPlaced) {
    return { ordrId: message.orderId }
  }

  async wrongFieldAsync(message: OrderPlaced) {
    return { orderId: message.orderId, extra: 1 }
  }

  wrongFieldInBranch(message: OrderPlaced) {
    return message.total > 1 ? { orderId: message.orderId } : { extra: 1 }
  }

  wrongNestedField() {
    return { customer: { name: 'a', nickname: 'b' } }
  }

  wrongFieldType(message: OrderPlaced) {
    return { orderId: message.total }
  }

  async notStateChanges() {
    return 'done'
  }

  wrongState(_message: OrderPlaced, state: OtherState) {
    return { orderId: state.otherId }
  }

  wrongContext(
    _message: OrderPlaced,
    _state: OrderState,
    _attributes: MessageAttributes,
    _ctx: string
  ) {}

  tooManyParameters(
    _message: OrderPlaced,
    _state: OrderState,
    _attributes: MessageAttributes,
    _ctx: HandlerContext,
    _extra: string
  ) {}
}

class UntypedWorkflow extends Workflow<OrderState> {
  configureWorkflow(mapper: WorkflowMapper<OrderState, any>): void {
    mapper
      .withState(OrderState)
      // @ts-expect-error the mapper must be typed with the workflow class to check handler names
      .startedBy(OrderPlaced, 'start')
  }

  start(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

const mapper = () =>
  new WorkflowMapper<OrderState, OrderWorkflow>(OrderWorkflow)

// These are compile-time checks: ts-jest fails the suite on a type error, or on an unused @ts-expect-error
describe('Workflow', () => {
  describe('when handlers are valid', () => {
    it('should compile them', () => {
      mapper().startedBy(OrderPlaced, 'start')
      mapper().startedBy(OrderPlaced, 'startAsync')
      mapper().startedBy(OrderPlaced, 'startUnion')
      mapper().startedBy(OrderPlaced, 'startExplicit')
      mapper().startedBy(OrderPlaced, 'startExplicitAsync')
      mapper().startedBy(OrderPlaced, 'startResult')
      mapper().startedBy(OrderPlaced, 'startTypedAttributes')
      mapper().startedBy(OrderPlaced, 'noArguments')
      mapper().startedBy(OrderPlaced, 'nothing')
      mapper().when(CardCharged, 'charged')
      mapper().when(CardCharged, 'chargedOrCancelled')
      mapper().when(OrderCancelled, 'chargedOrCancelled', {
        lookup: message => message.orderId,
        mapsTo: 'orderId'
      })
      mapper().when(OrderCancelled, 'cancelled')

      const sut = mapper()
      new OrderWorkflow().configureWorkflow(sut)
      expect(sut.onStartedBy.size).toEqual(1)
      expect(sut.onWhen.size).toEqual(2)
    })
  })

  describe('when handlers would fail at runtime', () => {
    it('should not compile them', () => {
      // @ts-expect-error strat isn't a method of the workflow
      mapper().startedBy(OrderPlaced, 'strat')

      // @ts-expect-error start takes OrderPlaced, not CardCharged
      mapper().when(CardCharged, 'start')

      // @ts-expect-error charged takes CardCharged, not OrderPlaced
      mapper().startedBy(OrderPlaced, 'charged')

      // @ts-expect-error ordrId isn't a field of the state
      mapper().startedBy(OrderPlaced, 'wrongField')

      // @ts-expect-error extra isn't a field of the state
      mapper().startedBy(OrderPlaced, 'wrongFieldAsync')

      // @ts-expect-error a branch returns a field that isn't in the state
      mapper().startedBy(OrderPlaced, 'wrongFieldInBranch')

      // @ts-expect-error customer has no nickname
      mapper().startedBy(OrderPlaced, 'wrongNestedField')

      // @ts-expect-error orderId is a string
      mapper().startedBy(OrderPlaced, 'wrongFieldType')

      // @ts-expect-error a handler returns state changes or nothing
      mapper().startedBy(OrderPlaced, 'notStateChanges')

      // @ts-expect-error the handler takes a different workflow state
      mapper().startedBy(OrderPlaced, 'wrongState')

      // @ts-expect-error the fourth parameter is the HandlerContext
      mapper().startedBy(OrderPlaced, 'wrongContext')

      // @ts-expect-error a handler is called with four arguments
      mapper().startedBy(OrderPlaced, 'tooManyParameters')

      // @ts-expect-error label isn't a method
      mapper().startedBy(OrderPlaced, 'label')

      // @ts-expect-error configureWorkflow isn't a handler
      mapper().startedBy(OrderPlaced, 'configureWorkflow')

      mapper().when(CardCharged, 'charged', {
        lookup: message => message.orderId,
        // @ts-expect-error mapsTo must be a field of the workflow state
        mapsTo: 'orderNumber'
      })

      expect(new UntypedWorkflow()).toBeInstanceOf(Workflow)
    })
  })

  describe('when a WorkflowHandler is called', () => {
    it('should require its parameters', () => {
      const handler: WorkflowHandler<
        OrderPlaced,
        MessageAttributes,
        OrderState
      > = message => ({ orderId: message.orderId })

      // @ts-expect-error the message is required
      expect(() => handler()).toThrow()
    })
  })
})
