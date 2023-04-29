export class WorkflowAlreadyInitialized extends Error {
  constructor() {
    super(
      `Attempted to initialize workflow registry after it has already been initialized`
    )

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
