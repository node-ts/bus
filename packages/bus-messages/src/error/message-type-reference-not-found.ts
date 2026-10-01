/**
 * Thrown when message types refer to a type key that they don't define
 */
export class MessageTypeReferenceNotFound extends Error {
  readonly help: string

  /**
   * @param typeKey the key that has no entry in `types`
   * @param referencedFrom where the key is used, e.g. a `$name` or `Type.field`
   */
  constructor(
    readonly typeKey: string,
    readonly referencedFrom: string
  ) {
    super(
      `Message types refer to "${typeKey}" from ${referencedFrom}, but don't define it`
    )
    this.help =
      'Regenerate the message types with `bus generate-message-types` rather than editing them by hand'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
