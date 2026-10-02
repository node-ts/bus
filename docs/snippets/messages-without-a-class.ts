import { handlerFor } from '@node-ts/bus-core'
import { defineCommand, defineEvent, MessageOf } from '@node-ts/bus-messages'

// #region define
export const RefundPayment = defineCommand('my-app/accounts/refund-payment')<{
  paymentId: string
  refundedAt: Date
}>()
export type RefundPayment = MessageOf<typeof RefundPayment>

// The contract version defaults to 0
export const PaymentRefunded = defineEvent('my-app/accounts/payment-refunded', {
  version: 1
})<{ paymentId: string }>()
export type PaymentRefunded = MessageOf<typeof PaymentRefunded>
// #endregion define

// #region use
export const refundPaymentHandler = handlerFor(
  RefundPayment,
  async (command, _attributes, ctx) => {
    await ctx.publish(PaymentRefunded({ paymentId: command.paymentId }))
  }
)
// #endregion use
