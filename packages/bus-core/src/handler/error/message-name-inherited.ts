/**
 * Thrown when a handler or workflow is registered for a message class that inherits its static `NAME` from the
 * class it extends. The bus would route it by the parent's name, so its own messages wouldn't reach the handler.
 */
export class MessageNameInherited extends Error {
  readonly help: string

  /**
   * @param messageType the message class that has no `NAME` of its own
   * @param inheritedName the `NAME` it inherits
   */
  constructor(
    readonly messageType: object,
    readonly inheritedName: string
  ) {
    const nameOf = (value: unknown): string | undefined =>
      (value as { name?: string } | null)?.name || undefined
    const name = nameOf(messageType) ?? 'The message class'
    const parentName =
      nameOf(Object.getPrototypeOf(messageType)) ?? 'the class it extends'
    super(
      `${name} inherits its static NAME "${inheritedName}" from ${parentName}, so the bus would route ${parentName}'s messages to its handler instead of its own`
    )
    this.help = `Give ${name} its own static NAME and set its $name to it (\`static NAME = '@my-org/orders/place-urgent-order'\` and \`$name = ${name}.NAME\`).`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
