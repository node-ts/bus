type Uuid = string

export interface MessageAttributeMap {
  [key: string]: string | number | boolean | undefined
}

export type Attributes<AttributesType extends MessageAttributeMap> =
  AttributesType
export type StickyAttributes<StickyAttributesType extends MessageAttributeMap> =
  StickyAttributesType

/**
 * Options that control the behaviour around how the message is sent and
 * additional information that travels with it.
 */
export interface MessageAttributes<
  AttributesType extends MessageAttributeMap = MessageAttributeMap,
  StickyAttributesType extends MessageAttributeMap = MessageAttributeMap
> {
  /**
   * An identifier that can be used to relate or group messages together.
   * This value is sticky, in that any messages that are sent as a result
   * of receiving one message will be sent out with this same correlationId.
   */
  correlationId?: Uuid

  /**
   * Additional metadata that will be sent alongside the message payload.
   * This is useful for sending information like:
   * - the id of a user where the message originated from
   * - the originating system hostname or IP for auditing information
   * - when the message was first sent
   *
   * These attributes will be attached to the outgoing message, but will not
   * propagate beyond the first receipt
   */
  attributes: AttributesType

  /**
   * Additional metadata that will be sent alongside the message payload.
   * This is useful for sending information like:
   * - The id of the user who originally sent the message that triggered this message
   *
   * These values are sticky, in that they will propagate for any message that
   * is sent as a result of receiving the message with sticky attributes.
   */
  stickyAttributes: StickyAttributesType
}

/**
 * The fields given to `messageAttributes()`. `attributes` and `stickyAttributes` can be left out when every one of
 * their keys is optional, and are required otherwise.
 */
export type MessageAttributesInput<
  AttributesType extends MessageAttributeMap = MessageAttributeMap,
  StickyAttributesType extends MessageAttributeMap = MessageAttributeMap
> = { correlationId?: Uuid } & ({} extends AttributesType
  ? { attributes?: AttributesType }
  : { attributes: AttributesType }) &
  ({} extends StickyAttributesType
    ? { stickyAttributes?: StickyAttributesType }
    : { stickyAttributes: StickyAttributesType })

/**
 * Creates `MessageAttributes` with `attributes` and `stickyAttributes` defaulted to `{}`, so a test can call a
 * handler directly without spelling out empty attributes. Handlers still receive both fields, so they read them
 * without `?.`.
 * @param input the correlation id and the attributes to set
 * @returns message attributes with any missing `attributes` or `stickyAttributes` set to `{}`
 * @example
 * await placeOrderHandler.messageHandler(PlaceOrder({ orderId: '1' }), messageAttributes(), fakeContext)
 * @example
 * messageAttributes({ correlationId: 'c', attributes: { tenantId: 'a' } })
 */
export const messageAttributes = <
  AttributesType extends MessageAttributeMap = {},
  StickyAttributesType extends MessageAttributeMap = {}
>(
  // The input can only be left out when neither map has a required key
  ...[input]: {} extends AttributesType & StickyAttributesType
    ? [input?: MessageAttributesInput<AttributesType, StickyAttributesType>]
    : [input: MessageAttributesInput<AttributesType, StickyAttributesType>]
): MessageAttributes<AttributesType, StickyAttributesType> =>
  ({
    ...input,
    attributes: input?.attributes ?? {},
    stickyAttributes: input?.stickyAttributes ?? {}
  }) as MessageAttributes<AttributesType, StickyAttributesType>
