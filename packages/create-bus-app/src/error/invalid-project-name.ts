/**
 * The project name made from the directory's name can't be used
 */
export class InvalidProjectName extends Error {
  readonly help =
    'Name the directory with letters, digits and dashes, in 50 characters or fewer. The name is used for the package and the queue.'

  /**
   * @param directoryName the name of the directory the app is created in
   * @param reason why the name can't be used
   */
  constructor(
    readonly directoryName: string,
    readonly reason: string
  ) {
    super(
      `A project can't be named after the directory ${directoryName}: ${reason}.`
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
