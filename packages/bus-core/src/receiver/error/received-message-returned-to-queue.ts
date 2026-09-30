import { TransportMessage } from '../../transport'

/**
 * A handler called `bus.returnMessage()` for a message delivered by a Receiver. The receiver host (e.g. Lambda)
 * owns deleting the message, so the message is reported to it as failed to stop it being deleted and have it retried.
 */
export class ReceivedMessageReturnedToQueue extends Error {
  readonly help: string

  /**
   * @param transportMessage The message that was returned to the queue
   */
  constructor(readonly transportMessage: TransportMessage<unknown>) {
    super(
      'Message was returned to the queue by a handler and has been reported to the receiver host as failed'
    )
    this.help =
      'This is expected when a handler calls bus.returnMessage(). The receiver host will retry the message.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
