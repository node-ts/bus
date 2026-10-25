/**
 * The directory to create the app in already has files in it
 */
export class DirectoryNotEmpty extends Error {
  readonly help =
    'Choose a new directory, or an empty one, so that no files are overwritten.'

  /**
   * @param directory the directory, as it was given
   */
  constructor(readonly directory: string) {
    super(`${directory} already exists and isn't an empty directory.`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
