/**
 * Thrown when a handler or workflow is registered for a message type that has no static `NAME`, so the
 * bus can't tell which messages it handles
 */
export class MessageNameMissing extends Error {
  readonly help: string

  /**
   * @param messageType the class or value given as the message type
   */
  constructor(readonly messageType: unknown) {
    const name =
      typeof messageType === 'function' && messageType.name
        ? messageType.name
        : String(messageType)
    super(
      `The message type ${name} has no static NAME, so the bus can't tell which messages it handles`
    )
    this.help = [
      `Give ${name} a static NAME and set its $name to it (\`static NAME = '@my-org/orders/place-order'\` and \`$name = ${name}.NAME\`),`,
      'or declare the message with defineCommand or defineEvent from @node-ts/bus-messages. The bus reads NAME without constructing the class.',
      'A message from another system that has no $name is handled with withCustomHandler and a resolver instead.'
    ].join(' ')

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
