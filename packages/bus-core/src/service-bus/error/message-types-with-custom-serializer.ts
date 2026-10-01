/**
 * Thrown when the bus is built with both `withMessageTypes()` and `withSerializer()`. Message types
 * configure the default serializer, so a custom serializer would silently ignore them.
 */
export class MessageTypesWithCustomSerializer extends Error {
  readonly help: string

  constructor() {
    super(
      'Message types were configured with withMessageTypes(), but a custom serializer was set with withSerializer()'
    )
    this.help =
      'Remove withSerializer() to use the default serializer with the message types, or pass the message types to your serializer yourself and remove withMessageTypes()'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
