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
import { CheckCredit, CreditChecked, OrderSubmitted } from './messages'
import { creditService } from './services'
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
// In the credit service. It replies by publishing CreditChecked while it
// handles the request, so the request's sticky attributes, and its
// workflowId, are copied to the reply
export const checkCreditHandler = handlerFor(
  CheckCredit,
  async ({ orderId, customerId, amount }, _attributes, ctx) => {
    const approved = await creditService.check(customerId, amount)
    await ctx.publish(new CreditChecked(orderId, approved))
  }
)
// #endregion handler

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
  // carry the workflowId
  .when(
    CreditChecked,
    { lookup: reply => reply.orderId, mapsTo: 'orderId' },
    ({ approved }, _state, ctx) =>
      ctx.complete({ status: approved ? 'approved' : 'declined' })
  )
// #endregion field-mapping

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
