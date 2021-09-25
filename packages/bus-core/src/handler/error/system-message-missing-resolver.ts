import { MessageBase } from '../handler'

export class SystemMessageMissingResolver extends Error {
  readonly help: string

  constructor (
    readonly messageType: MessageBase
  ) {
    super(`A system message has been registered without providing a custom resolver.`)
    this.help = `Ensure your .withHandler includes a customResolver with resolveWith supplied.`

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
