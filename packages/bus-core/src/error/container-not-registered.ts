export class ContainerNotRegistered extends Error {
  constructor(readonly classHandlerName: string) {
    super(
      `A class-based handler is registered for this message, however no IoC container has been provided.` +
        ` Ensure that Bus.configure().withContainer(...) has been called with a valid adapter to your IoC container.`
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
