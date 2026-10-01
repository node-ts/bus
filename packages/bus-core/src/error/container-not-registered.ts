/**
 * Thrown by `build()` when a class handler's constructor takes arguments but no container has been given to
 * resolve it, since the bus can only construct class handlers that take no arguments
 */
export class ContainerNotRegistered extends Error {
  readonly help: string

  /**
   * @param classHandlerName Name of the class handler that can't be constructed without a container
   */
  constructor(readonly classHandlerName: string) {
    super(
      `Class handler ${classHandlerName} has constructor arguments, but no container has been registered to resolve it`
    )
    this.help =
      `Call Bus.configure().withContainer(...) with an adapter to your IoC container that resolves ${classHandlerName},` +
      ` give ${classHandlerName} a constructor with no arguments, or use a function handler declared with handlerFor` +
      ` that gets its dependencies from a closure.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
