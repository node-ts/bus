import { Message } from './message'

/**
 * The fields of a message, without its `$name` and `$version`
 */
export type MessageData<TMessage extends Message> = Omit<
  TMessage,
  '$name' | '$version'
>

/**
 * A message declared with `defineCommand` or `defineEvent`: its fields, plus its `$name` and `$version`
 */
export type DefinedMessage<
  TName extends string,
  TData extends object
> = TData & {
  readonly $name: TName
  readonly $version: number
}

/**
 * A message class. Its static `NAME` must be the `$name` of its instances, so the bus can read which
 * message it is without constructing it.
 * @example
 * class PlaceOrder extends Command {
 *   static NAME = '@my-org/orders/place-order'
 *   $name = PlaceOrder.NAME
 *   $version = 0
 * }
 */
export interface MessageClass<TMessage extends Message = Message> {
  new (...args: any[]): TMessage

  /**
   * The `$name` of every instance of the class
   */
  readonly NAME: string
}

/**
 * A message declared with `defineCommand` or `defineEvent`: a function that creates the message from
 * its fields. Messages it creates, and messages of its type that are received, are plain objects.
 * @example
 * const PlaceOrder = defineCommand('@my-org/orders/place-order')<{ orderId: string }>()
 * const placeOrder = PlaceOrder({ orderId: '1' })
 */
export interface MessageDefinition<
  TMessage extends Message = Message,
  TData extends object = MessageData<TMessage>
> {
  /**
   * Creates a message
   * @param data the fields of the message. They're copied, and `$name` and `$version` are added.
   * It can be left out when the message has no required fields.
   * @returns the message
   */
  (...data: {} extends TData ? [data?: TData] : [data: TData]): TMessage

  /**
   * The `$name` of every message it creates
   */
  readonly NAME: TMessage['$name']
}

/**
 * Anything that declares a message type, and that `handlerFor`, `startedBy` and `when` accept: a
 * message class with a static `NAME`, or a message declared with `defineCommand` or `defineEvent`
 */
export type MessageDeclaration<TMessage extends Message = Message> =
  MessageClass<TMessage> | MessageDefinition<TMessage, any>

/**
 * The type of the messages of a message declaration
 * @example
 * export const PlaceOrder = defineCommand('@my-org/orders/place-order')<{ orderId: string }>()
 * export type PlaceOrder = MessageOf<typeof PlaceOrder>
 */
export type MessageOf<TDeclaration extends MessageDeclaration<any>> =
  TDeclaration extends MessageClass<infer TMessage>
    ? TMessage
    : TDeclaration extends MessageDefinition<infer TMessage, any>
      ? TMessage
      : never
