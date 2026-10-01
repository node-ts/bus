import { defineMessage } from './define-message'
import { DefineMessageOptions } from './define-message-options'
import { DefinedMessage, MessageDefinition } from './message-declaration'

/**
 * Declares a command, an instruction sent to one handler, without writing a class. The definition
 * creates commands from their fields, and is used anywhere a message class is: `handlerFor`,
 * `startedBy` and `when`. The commands it creates are plain objects, with `$name` and `$version`
 * added.
 *
 * The name comes first and the fields second, so the name's literal type is inferred. Run
 * `bus generate-message-types` (in `@node-ts/bus-cli`) to have Dates, Maps, Sets, bigints and classes
 * in the fields restored when the command is received.
 * @param name the `$name` of the command, which routes it, so make it unique
 * @param options the `$version` of the command's contract
 * @returns a function that takes the type of the command's fields as its type argument, and returns
 * the definition
 * @example
 * export const PlaceOrder = defineCommand('@my-org/orders/place-order')<{
 *   orderId: string
 *   placedAt: Date
 * }>()
 * export type PlaceOrder = MessageOf<typeof PlaceOrder>
 *
 * await bus.send(PlaceOrder({ orderId: '1', placedAt: new Date() }))
 * handlerFor(PlaceOrder, async placeOrder => placeOrder.placedAt.getTime())
 */
export const defineCommand =
  <TName extends string>(name: TName, options?: DefineMessageOptions) =>
  <TData extends object = {}>(): MessageDefinition<
    DefinedMessage<TName, TData>,
    TData
  > =>
    defineMessage<TName, TData>(name, options)
