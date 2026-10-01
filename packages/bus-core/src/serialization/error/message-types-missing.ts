/**
 * Thrown when a bus that receives messages initializes, but some of the messages it handles or the
 * workflow state it persists have no entry in the message types passed to `withMessageTypes()`
 */
export class MessageTypesMissing extends Error {
  readonly help: string

  /**
   * @param missingNames the `$name` of each message or workflow state that has no entry
   */
  constructor(readonly missingNames: string[]) {
    super(`The bus has no message types for: ${missingNames.join(', ')}`)
    this.help = [
      'Generate message types with `bus generate-message-types` (from @node-ts/bus-cli) in each package that declares these messages or workflow state, and pass every generated file to the bus:',
      "  import { messageTypes } from './message-types.generated'",
      '  Bus.configure().withMessageTypes(messageTypes)',
      'If the file is already passed, regenerate it, since it may be out of date.'
    ].join('\n')

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
