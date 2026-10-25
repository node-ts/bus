/**
 * A transport or persistence was asked for that the template doesn't have
 */
export class OptionNotFound extends Error {
  readonly help: string

  /**
   * @param flag the flag it was given with, such as `--transport`
   * @param value what was given
   * @param available the names that can be given
   */
  constructor(
    readonly flag: string,
    readonly value: string,
    readonly available: string[]
  ) {
    super(`${flag} ${value} isn't one of the options.`)
    this.help = `Use one of: ${available.join(', ')}.`
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
