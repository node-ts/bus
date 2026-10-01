/**
 * Thrown when the container given to `withContainer()` doesn't return an instance of a class handler
 */
export class ClassHandlerNotResolved extends Error {
  readonly help: string

  /**
   * @param classHandlerName Name of the class handler that couldn't be resolved
   * @param reason Why the container failed to resolve it
   * @param cause The error the container threw, if any
   */
  constructor(
    readonly classHandlerName: string,
    readonly reason?: string,
    cause?: unknown
  ) {
    super(
      `Unable to resolve class handler ${classHandlerName} from the container` +
        (reason ? `: ${reason}` : ''),
      { cause }
    )
    this.help =
      `Register ${classHandlerName} with your container, and check that the adapter given to .withContainer(...)` +
      ` returns an instance of it. Without .withContainer(...), class handlers are constructed with` +
      ` \`new ${classHandlerName}()\`.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
