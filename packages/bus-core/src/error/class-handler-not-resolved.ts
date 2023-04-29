export class ClassHandlerNotResolved extends Error {
  constructor(readonly reason?: string) {
    super(
      `Unable to retrieve a class instance from the DI container.` +
        ` Ensure that the class has been registered with your container and that` +
        ` the containerAdapter from .withContainer(...) is correct.`
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
