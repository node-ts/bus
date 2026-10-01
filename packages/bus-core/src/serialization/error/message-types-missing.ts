/**
 * Thrown when the bus initializes with message types configured, but some of the messages it
 * handles or the workflow state it persists have no entry in them
 */
export class MessageTypesMissing extends Error {
  readonly help: string

  /**
   * @param missingNames the `$name` of each message or workflow state that has no entry
   */
  constructor(readonly missingNames: string[]) {
    super(
      `The configured message types have no entry for: ${missingNames.join(', ')}`
    )
    this.help =
      'Regenerate the message types with `bus generate-message-types`, and check its entry glob includes the files that declare these classes'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
