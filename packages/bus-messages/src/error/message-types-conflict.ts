/**
 * Thrown when registered message types define the same `$name` or type key differently, so it's
 * ambiguous how to restore it
 */
export class MessageTypesConflict extends Error {
  readonly help: string

  /**
   * @param kind whether a message `$name` or a type key conflicts
   * @param key the `$name` or type key that is defined more than once
   */
  constructor(
    readonly kind: '$name' | 'type',
    readonly key: string
  ) {
    super(
      kind === '$name'
        ? `Two registered message types map the $name "${key}" to different types`
        : `Two registered message types define the type "${key}" differently`
    )
    this.help =
      kind === '$name'
        ? 'Two message libraries declare a message with the same $name. Give each message a unique $name'
        : 'Regenerate each library with the current `bus generate-message-types`, which keys types by package and module'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
