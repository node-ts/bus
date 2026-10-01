import { Message, MessageDeclaration } from '@node-ts/bus-messages'
import { HandlerDefinition } from './handler'

/**
 * Declares a message handling function
 * @param messageType Type of message that the function handles: a message class with a static `NAME`, or a
 * definition from `defineCommand` or `defineEvent`
 * @param messageHandler Function that is executed each time the type of message is read from the bus. It's passed
 * the message, its attributes and a `HandlerContext` to send and publish through the bus that received it.
 * @returns The message type and the handler, typed as given so a function handler can be called directly in tests
 * @example
 * const placeOrderHandler = handlerFor(PlaceOrder, async (message, attributes, ctx) => {
 *   await ctx.publish(new OrderPlaced(message.orderId))
 * })
 * @example
 * const PlaceOrder = defineCommand('@my-org/orders/place-order')<{ orderId: string }>()
 * const placeOrderHandler = handlerFor(PlaceOrder, async placeOrder => placeOrder.orderId)
 */
export const handlerFor = <
  TMessageType extends Message,
  THandler extends HandlerDefinition<TMessageType> =
    HandlerDefinition<TMessageType>
>(
  messageType: MessageDeclaration<TMessageType>,
  messageHandler: THandler
) => {
  return {
    messageType,
    messageHandler
  }
}
