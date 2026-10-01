/**
 * Thrown when the project doesn't have TypeScript installed, which the generator uses to read it
 */
export class TypeScriptNotFound extends Error {
  readonly help: string

  /**
   * @param cwd the directory TypeScript was looked up from
   */
  constructor(readonly cwd: string) {
    super(`TypeScript could not be found from ${cwd}`)
    this.help =
      'Install it in the project that declares your messages, e.g. `npm i --save-dev typescript`. The generator reads your code with the same compiler version as your build'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
