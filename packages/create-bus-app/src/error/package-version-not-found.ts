/**
 * The template depends on a workspace package whose version wasn't recorded when create-bus-app was built
 */
export class PackageVersionNotFound extends Error {
  readonly help =
    'This is a bug in @node-ts/create-bus-app: report it at https://github.com/node-ts/bus/issues.'

  /**
   * @param packageName the package
   */
  constructor(readonly packageName: string) {
    super(`The version of ${packageName} to depend on isn't known.`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
