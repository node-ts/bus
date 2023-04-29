import { BusState } from '../bus-state'

export class InvalidBusState extends Error {
  constructor(
    message: string,
    readonly actualState: BusState,
    readonly expectedState: BusState[]
  ) {
    super(message)

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
