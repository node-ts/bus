/**
 * Thrown by a `testWorkflow()` scenario's `advanceTime()` when it's given a time that can't be added to its clock
 */
export class InvalidTimeAdvance extends Error {
  readonly help: string

  /**
   * @param milliseconds The time that was given
   */
  constructor(readonly milliseconds: number) {
    super(`Can't advance a workflow scenario's clock by ${milliseconds} ms`)
    this.help =
      'Pass advanceTime() a finite number of milliseconds of 0 or more, such as the deliverAfter of the timeout to deliver.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
