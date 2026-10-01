import { defineMessage } from './define-message'
import { DefineMessageOptions } from './define-message-options'
import { DefinedMessage, MessageDefinition } from './message-declaration'

/**
 * Declares an event, something that happened that is published to every subscriber, without writing
 * a class. The definition creates events from their fields, and is used anywhere a message class is:
 * `handlerFor`, `startedBy` and `when`. The events it creates are plain objects, with `$name` and
 * `$version` added.
 *
 * The name comes first and the fields second, so the name's literal type is inferred. Run
 * `bus generate-message-types` (in `@node-ts/bus-cli`) to have Dates, Maps, Sets, bigints and classes
 * in the fields restored when the event is received.
 * @param name the `$name` of the event, which routes it, so make it unique
 * @param options the `$version` of the event's contract
 * @returns a function that takes the type of the event's fields as its type argument, and returns
 * the definition
 * @example
 * export const OrderPlaced = defineEvent('@my-org/orders/order-placed')<{
 *   orderId: string
 *   placedAt: Date
 * }>()
 * export type OrderPlaced = MessageOf<typeof OrderPlaced>
 *
 * await bus.publish(OrderPlaced({ orderId: '1', placedAt: new Date() }))
 * handlerFor(OrderPlaced, async orderPlaced => orderPlaced.placedAt.getTime())
 */
export const defineEvent =
  <TName extends string>(name: TName, options?: DefineMessageOptions) =>
  <TData extends object = {}>(): MessageDefinition<
    DefinedMessage<TName, TData>,
    TData
  > =>
    defineMessage<TName, TData>(name, options)
