const describe = (messageType: unknown): { message: string; help: string } => {
  if (messageType === undefined || messageType === null) {
    return {
      message: `The message type is ${String(messageType)}, so the bus can't tell which messages the handler handles`,
      help: [
        'This is usually a circular import: the module that declares the message was still loading when the handler',
        'was declared, so its export was undefined. Move the message into a module that imports neither the handler',
        'nor the module that configures the bus.'
      ].join(' ')
    }
  }
  const name =
    typeof messageType === 'function' && messageType.name
      ? messageType.name
      : String(messageType)
  return {
    message: `The message type ${name} has no static NAME, so the bus can't tell which messages it handles`,
    help: [
      `Give ${name} a static NAME and set its $name to it (\`static NAME = '@my-org/orders/place-order'\` and \`$name = ${name}.NAME\`),`,
      'or declare the message with defineCommand or defineEvent from @node-ts/bus-messages. The bus reads NAME without constructing the class.',
      'A message from another system that has no $name is handled with withCustomHandler and a resolver instead.'
    ].join(' ')
  }
}

/**
 * Thrown when a handler or workflow is registered for a message type that has no static `NAME`, or that is
 * `undefined` because of a circular import, so the bus can't tell which messages it handles
 */
export class MessageNameMissing extends Error {
  readonly help: string

  /**
   * @param messageType the class or value given as the message type
   */
  constructor(readonly messageType: unknown) {
    const { message, help } = describe(messageType)
    super(message)
    this.help = help

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
