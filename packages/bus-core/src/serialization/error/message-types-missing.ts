/**
 * Thrown when the bus initializes with message types registered, but some of the messages it
 * handles or the workflow state it persists have no entry in them
 */
export class MessageTypesMissing extends Error {
  readonly help: string

  /**
   * @param missingNames the `$name` of each message or workflow state that has no entry
   */
  constructor(readonly missingNames: string[]) {
    super(`No message types are registered for: ${missingNames.join(', ')}`)
    this.help = [
      'Run `bus generate-message-types` in the package that declares them, and make sure the generated file is imported before the bus initializes:',
      "- in a message library, re-export it from the package's entry: `export * from './message-types.generated'` in src/index.ts",
      "- for messages declared in this service, import it where the messages are exported or the bus is configured: `import './message-types.generated'`"
    ].join('\n')

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
