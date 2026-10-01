import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { FunctionHandler, HandlerDefinition } from './handler'

// Function handlers come first, so an explicit `handlerFor<TMessage, TAttributes>` gives a handler that can be called
// directly. Class handlers fall through to the second overload.
/**
 * Declares a message handling function
 * @param messageType Type of message that the function handles: a message class with a static `NAME`, or a
 * definition from `defineCommand` or `defineEvent`
 * @param messageHandler Function that is executed each time the type of message is read from the bus. It's passed
 * the message, its attributes and a `HandlerContext` to send and publish through the bus that received it. Its
 * return value is ignored, and a returned promise is awaited.
 * @returns The message type and the handler, typed as given so a function handler can be called directly in tests
 * @typeParam TMessageType The message the handler handles, inferred from `messageType`
 * @typeParam TMessageAttributes The attributes the handler reads, such as
 * `MessageAttributes<{ tenantId: string }>`. Give it with the message type to type the handler's `attributes`.
 * @example
 * const placeOrderHandler = handlerFor(PlaceOrder, async (message, attributes, ctx) => {
 *   await ctx.publish(new OrderPlaced(message.orderId))
 * })
 * @example
 * const PlaceOrder = defineCommand('@my-org/orders/place-order')<{ orderId: string }>()
 * const placeOrderHandler = handlerFor(PlaceOrder, async placeOrder => repository.save(placeOrder))
 * @example
 * type TenantAttributes = MessageAttributes<{ tenantId: string }>
 * const placeOrderHandler = handlerFor<PlaceOrder, TenantAttributes>(PlaceOrder, async (message, attributes) =>
 *   repository.save(attributes.attributes.tenantId, message)
 * )
 * @example
 * const placeOrderHandler = handlerFor<PlaceOrder>(PlaceOrder, PlaceOrderClassHandler)
 */
export function handlerFor<
  TMessageType extends Message,
  TMessageAttributes extends MessageAttributes = MessageAttributes,
  THandler extends FunctionHandler<TMessageType, TMessageAttributes> =
    FunctionHandler<TMessageType, TMessageAttributes>
>(
  messageType: MessageDeclaration<TMessageType>,
  messageHandler: THandler
): HandlerFor<TMessageType, THandler>
export function handlerFor<
  TMessageType extends Message,
  TMessageAttributes extends MessageAttributes = MessageAttributes,
  THandler extends HandlerDefinition<TMessageType, TMessageAttributes> =
    HandlerDefinition<TMessageType, TMessageAttributes>
>(
  messageType: MessageDeclaration<TMessageType>,
  messageHandler: THandler
): HandlerFor<TMessageType, THandler>
export function handlerFor<TMessageType extends Message, THandler>(
  messageType: MessageDeclaration<TMessageType>,
  messageHandler: THandler
): HandlerFor<TMessageType, THandler> {
  return {
    messageType,
    messageHandler
  }
}

/**
 * A message type and the handler declared for it with `handlerFor`, ready to pass to `withHandler`
 */
export interface HandlerFor<TMessageType extends Message, THandler> {
  /**
   * The message class or definition the handler handles
   */
  messageType: MessageDeclaration<TMessageType>
  /**
   * The handler, typed as it was given
   */
  messageHandler: THandler
}
