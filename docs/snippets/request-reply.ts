import {
  Bus,
  defineWorkflow,
  HandlerContext,
  handlerFor,
  Workflow,
  WorkflowMapper
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { messageTypes } from './message-types.generated'
import {
  CheckCredit,
  CreditChecked,
  CreditCheckTimedOut,
  OrderSubmitted
} from './messages'
import { creditService } from './services'
import { CreditCheckState } from './workflows/credit-check-state'
import { OrderApprovalState } from './workflows/order-approval-state'

// #region workflow
export const orderApprovalWorkflow = defineWorkflow(OrderApprovalState)
  // Send the request. CheckCredit carries this instance's workflowId in its
  // sticky attributes
  .startedBy(
    OrderSubmitted,
    async ({ orderId, customerId, amount }, _state, ctx) => {
      await ctx.send(new CheckCredit(orderId, customerId, amount))
      return { orderId, status: 'checking-credit' as const }
    }
  )
  // Handle the reply. With no mapping, it's found by its workflowId
  .when(CreditChecked, ({ approved }, _state, ctx) =>
    ctx.complete({ status: approved ? 'approved' : 'declined' })
  )
// #endregion workflow

// #region class-workflow
export class OrderApprovalWorkflow extends Workflow<OrderApprovalState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderApprovalState, OrderApprovalWorkflow>
  ): void {
    mapper
      .withState(OrderApprovalState)
      .startedBy(OrderSubmitted, 'checkCredit')
      // With no mapping, the reply is found by its workflowId
      .when(CreditChecked, 'creditChecked')
  }

  async checkCredit(
    { orderId, customerId, amount }: OrderSubmitted,
    _state: OrderApprovalState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new CheckCredit(orderId, customerId, amount))
    return { orderId, status: 'checking-credit' as const }
  }

  creditChecked({ approved }: CreditChecked) {
    return this.completeWorkflow({
      status: approved ? ('approved' as const) : ('declined' as const)
    })
  }
}
// #endregion class-workflow

// #region handler
// In the credit service. The reply goes straight back to the service that
// sent CheckCredit, with the request's workflowId
export const checkCreditHandler = handlerFor(
  CheckCredit,
  async ({ orderId, customerId, amount }, _attributes, ctx) => {
    const approved = await creditService.check(customerId, amount)
    await ctx.reply(new CreditChecked(orderId, approved))
  }
)
// #endregion handler

// #region replying-workflow
// In the credit service, a workflow that keeps a record of each check. The
// reply carries the requesting workflow's workflowId, not this one's
export const creditCheckWorkflow = defineWorkflow(CreditCheckState).startedBy(
  CheckCredit,
  async ({ orderId, customerId, amount }, _state, ctx) => {
    const approved = await creditService.check(customerId, amount)
    await ctx.reply(new CreditChecked(orderId, approved))
    return { orderId, approved }
  }
)
// #endregion replying-workflow

// #region replying-class-workflow
export class CreditCheckWorkflow extends Workflow<CreditCheckState> {
  configureWorkflow(
    mapper: WorkflowMapper<CreditCheckState, CreditCheckWorkflow>
  ): void {
    mapper.withState(CreditCheckState).startedBy(CheckCredit, 'checkCredit')
  }

  async checkCredit(
    { orderId, customerId, amount }: CheckCredit,
    _state: CreditCheckState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    const approved = await creditService.check(customerId, amount)
    // The reply carries the requesting workflow's workflowId, not this one's
    await ctx.reply(new CreditChecked(orderId, approved))
    return { orderId, approved }
  }
}
// #endregion replying-class-workflow

// #region field-mapping
export const orderApprovalByOrderWorkflow = defineWorkflow(OrderApprovalState)
  .startedBy(
    OrderSubmitted,
    async ({ orderId, customerId, amount }, _state, ctx) => {
      await ctx.send(new CheckCredit(orderId, customerId, amount))
      return { orderId, status: 'checking-credit' as const }
    }
  )
  // Find the instance by the reply's orderId, so the reply doesn't need to
  // carry the workflowId, such as when another system sends it
  .when(
    CreditChecked,
    { lookup: reply => reply.orderId, mapsTo: 'orderId' },
    ({ approved }, _state, ctx) =>
      ctx.complete({ status: approved ? 'approved' : 'declined' })
  )
// #endregion field-mapping

// #region timeout
const CREDIT_CHECK_TIMEOUT_MS = 5 * 60 * 1_000

export const orderApprovalWithTimeoutWorkflow = defineWorkflow(
  OrderApprovalState
)
  .startedBy(
    OrderSubmitted,
    async ({ orderId, customerId, amount }, _state, ctx) => {
      await ctx.send(new CheckCredit(orderId, customerId, amount))
      // Comes back to this instance in 5 minutes, unless it has completed
      await ctx.send(new CreditCheckTimedOut(), {
        deliverAfter: CREDIT_CHECK_TIMEOUT_MS
      })
      return { orderId, status: 'checking-credit' as const }
    }
  )
  .when(CreditChecked, ({ approved }, _state, ctx) =>
    ctx.complete({ status: approved ? 'approved' : 'declined' })
  )
  .when(CreditCheckTimedOut, (_timeout, _state, ctx) =>
    ctx.complete({ status: 'credit-check-timed-out' })
  )
// #endregion timeout

// #region class-timeout
export class OrderApprovalWithTimeoutWorkflow extends Workflow<OrderApprovalState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderApprovalState, OrderApprovalWithTimeoutWorkflow>
  ): void {
    mapper
      .withState(OrderApprovalState)
      .startedBy(OrderSubmitted, 'checkCredit')
      .when(CreditChecked, 'creditChecked')
      .when(CreditCheckTimedOut, 'creditCheckTimedOut')
  }

  async checkCredit(
    { orderId, customerId, amount }: OrderSubmitted,
    _state: OrderApprovalState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new CheckCredit(orderId, customerId, amount))
    // Comes back to this instance in 5 minutes, unless it has completed
    await ctx.send(new CreditCheckTimedOut(), {
      deliverAfter: CREDIT_CHECK_TIMEOUT_MS
    })
    return { orderId, status: 'checking-credit' as const }
  }

  creditChecked({ approved }: CreditChecked) {
    return this.completeWorkflow({
      status: approved ? ('approved' as const) : ('declined' as const)
    })
  }

  creditCheckTimedOut() {
    return this.completeWorkflow({ status: 'credit-check-timed-out' })
  }
}
// #endregion class-timeout

// #region services
// The orders service runs the workflow. Give it a persistence, such as
// Postgres, so its state survives a restart
const ordersBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(
    new RabbitMqTransport({
      queueName: 'orders-service',
      connectionString: 'amqp://guest:guest@localhost'
    })
  )
  .withWorkflow(orderApprovalWorkflow)
  .build()

// The credit service handles the request
const creditBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(
    new RabbitMqTransport({
      queueName: 'credit-service',
      connectionString: 'amqp://guest:guest@localhost'
    })
  )
  .withHandler(checkCreditHandler)
  .build()
// #endregion services

await creditBus.initialize()
await creditBus.start()
await ordersBus.initialize()
await ordersBus.start()
await ordersBus.publish(new OrderSubmitted('order-1', 'customer-1', 250))
