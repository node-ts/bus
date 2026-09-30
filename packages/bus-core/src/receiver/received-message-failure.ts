import { TransportMessage } from '../transport'

/**
 * A message from a received batch that failed to be handled.
 */
export interface ReceivedMessageFailure<
  TTransportMessage extends TransportMessage<unknown> =
    TransportMessage<unknown>
> {
  /**
   * The transport message, as produced by the receiver, that failed
   */
  message: TTransportMessage
  /**
   * The error that caused the message to fail
   */
  error: Error
}
