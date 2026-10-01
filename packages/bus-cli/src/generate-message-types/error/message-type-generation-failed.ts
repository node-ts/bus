/**
 * Thrown when message types can't be generated, e.g. because a message has a field whose type
 * can't be restored from JSON
 */
export class MessageTypeGenerationFailed extends Error {
  readonly help: string

  /**
   * @param problems what stopped each message type from being generated, one per line
   */
  constructor(readonly problems: string[]) {
    super(
      `Message types could not be generated:\n${problems.map(problem => `  - ${problem}`).join('\n')}`
    )
    this.help =
      'Change the types listed above to ones the generator supports (see the @node-ts/bus-cli README), or leave their files out with --exclude'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
