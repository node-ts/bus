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
  meta: unknown
  settings: Record<string, unknown>
  payload: object
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

const OrderShipped = defineCommand(
  '@node-ts/bus-core/workflow-types-spec-order-shipped'
)<{ orderId: string }>()

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

class ShippingWorkflow extends Workflow<OrderState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, ShippingWorkflow>
  ): void {
    mapper
      .withState(OrderState)
      // A misspelt name lists the workflow's methods. tsc reports:
      //   Argument of type '"handleOrdrPlaced"' is not assignable to parameter of type
      //   '"handleOrderPlaced" | "handleCardCharged"'.
      // When some methods can't handle the message, the list ends with `& { ...; }`, and past ten names it's cut
      // short as `... N more ...`.
      // @ts-expect-error handleOrdrPlaced is misspelt
      .startedBy(OrderPlaced, 'handleOrdrPlaced')
      .when(CardCharged, 'handleCardCharged')
  }

  handleOrderPlaced(message: OrderPlaced) {
    return { orderId: message.orderId }
  }

  handleCardCharged() {
    return this.completeWorkflow({ charged: true })
  }
}

class LooseFieldsWorkflow extends Workflow<OrderState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, LooseFieldsWorkflow>
  ): void {
    mapper
      .withState(OrderState)
      .startedBy(OrderPlaced, 'start')
      .when(CardCharged, 'parsed')
      .when(OrderCancelled, 'typedAny')
  }

  // Fields typed unknown, object or Record<string, unknown> take any nested object
  start() {
    return {
      meta: { anything: 1 },
      settings: { a: { b: 1 } },
      payload: { x: { y: 1 } }
    }
  }

  // Nothing is known about what an any returns, so it isn't checked
  parsed() {
    return JSON.parse('{}')
  }

  async typedAny(): Promise<any> {
    return JSON.parse('{}')
  }
}

class UnrelatedWorkflow extends Workflow<OrderState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, UnrelatedWorkflow>
  ): void {
    mapper.withState(OrderState).startedBy(OrderPlaced, 'foo')
  }

  foo(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

class CopiedWorkflow extends Workflow<OrderState> {
  // @ts-expect-error the mapper must be typed with this workflow, not another one
  configureWorkflow(mapper: WorkflowMapper<OrderState, UnrelatedWorkflow>) {
    mapper.withState(OrderState).startedBy(OrderPlaced, 'foo')
  }

  bar(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

class ExtendedOrderWorkflow extends OrderWorkflow {
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, ExtendedOrderWorkflow>
  ): void {
    super.configureWorkflow(mapper)
    mapper.when(OrderShipped, 'extra')
  }

  extra() {
    return { charged: true }
  }
}

class GenericOrderWorkflow<TState extends OrderState> extends Workflow<TState> {
  // A generic state can't be checked, so type the mapper with a concrete state
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, GenericOrderWorkflow<OrderState>>
  ): void {
    mapper.withState(OrderState).startedBy(OrderPlaced, 'start')
  }

  start(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

class GenericMapperWorkflow<
  TState extends OrderState
> extends Workflow<TState> {
  configureWorkflow(
    mapper: WorkflowMapper<TState, GenericMapperWorkflow<TState>>
  ): void {
    // TypeScript defers the checks of a handler against a generic state, so no handler name compiles. Type the
    // mapper with a concrete state, as GenericOrderWorkflow does.
    // @ts-expect-error the state is still a type parameter
    mapper.startedBy(OrderPlaced, 'start')
  }

  start(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

class ThisMapperWorkflow extends Workflow<OrderState> {
  configureWorkflow(mapper: WorkflowMapper<OrderState, this>): void {
    mapper
      .withState(OrderState)
      // @ts-expect-error `this` could be any subclass, so its handler names can't be checked
      .startedBy(OrderPlaced, 'start')
  }

  start(message: OrderPlaced) {
    return { orderId: message.orderId }
  }
}

class ProtectedHandlerWorkflow extends Workflow<OrderState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderState, ProtectedHandlerWorkflow>
  ): void {
    mapper
      .withState(OrderState)
      // With no public methods, tsc reports: Argument of type 'string' is not assignable to parameter of type
      // '{ 'The workflow has no public methods. Make handler methods public, since protected and private ones can not
      // be named': never; }'. With other public methods, the error lists them as for a misspelt name.
      // @ts-expect-error handlers must be public methods
      .startedBy(OrderPlaced, 'start')
  }

  protected start(message: OrderPlaced) {
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
      expect(new ShippingWorkflow()).toBeInstanceOf(Workflow)
    })
  })

  describe('when the mapper is typed with another workflow', () => {
    it('should not compile it', () => {
      // @ts-expect-error a mapper of one workflow isn't a mapper of an unrelated one
      const copied: WorkflowMapper<OrderState, CopiedWorkflow> =
        new WorkflowMapper<OrderState, UnrelatedWorkflow>(UnrelatedWorkflow)

      expect(copied).toBeInstanceOf(WorkflowMapper)
      expect(new CopiedWorkflow()).toBeInstanceOf(Workflow)
    })
  })

  describe('when a workflow extends another workflow', () => {
    it('should compile its mapper and super.configureWorkflow', () => {
      const sut = new WorkflowMapper<OrderState, ExtendedOrderWorkflow>(
        ExtendedOrderWorkflow
      )
      new ExtendedOrderWorkflow().configureWorkflow(sut)
      expect(sut.onWhen.size).toEqual(3)
    })
  })

  describe('when handlers return into loosely typed fields or return any', () => {
    it('should compile them', () => {
      const sut = new WorkflowMapper<OrderState, LooseFieldsWorkflow>(
        LooseFieldsWorkflow
      )
      new LooseFieldsWorkflow().configureWorkflow(sut)
      expect(sut.onWhen.size).toEqual(2)
    })
  })

  describe('when a generic workflow types its mapper with a concrete state', () => {
    it('should compile it', () => {
      const sut = new WorkflowMapper<
        OrderState,
        GenericOrderWorkflow<OrderState>
      >(GenericOrderWorkflow)
      new GenericOrderWorkflow().configureWorkflow(sut)
      expect(sut.onStartedBy.size).toEqual(1)
      expect(new GenericMapperWorkflow()).toBeInstanceOf(Workflow)
      expect(new ThisMapperWorkflow()).toBeInstanceOf(Workflow)
    })
  })

  describe('when a handler is protected', () => {
    it('should not compile it', () => {
      expect(new ProtectedHandlerWorkflow()).toBeInstanceOf(Workflow)
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
