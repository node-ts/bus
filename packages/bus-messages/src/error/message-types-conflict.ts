const describeSources = (sources: (string | undefined)[]): string =>
  sources.every(source => source !== undefined)
    ? ` (in ${sources.join(' and ')})`
    : ''

/**
 * Thrown when message types passed to the same bus define the same `$name` or type key
 * differently, so it's ambiguous how to restore it
 */
export class MessageTypesConflict extends Error {
  readonly help: string

  /**
   * @param kind whether a message `$name` or a type key conflicts
   * @param key the `$name` or type key that is defined more than once
   * @param sources the `source` of the two message types that define it, where they have one
   */
  constructor(
    readonly kind: '$name' | 'type',
    readonly key: string,
    readonly sources: (string | undefined)[] = []
  ) {
    super(
      kind === '$name'
        ? `Two message types map the $name "${key}" to different types${describeSources(sources)}`
        : `Two message types define the type "${key}" differently${describeSources(sources)}`
    )
    this.help =
      kind === '$name'
        ? 'Two message libraries passed to the same bus declare a message with the same $name. Give each message a unique $name'
        : 'Regenerate each library with the current `bus generate-message-types`, which keys types by package and module'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
