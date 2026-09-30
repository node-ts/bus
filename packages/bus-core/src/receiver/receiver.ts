import { TransportMessage } from '../transport'
import { MessageSerializer } from '../serialization'
import { ReceivedMessageFailure } from './received-message-failure'

/**
 * When used, the app will be responsible for receiving its own messages rather than subscribing directly
 * to the transport. This can be useful for local testing or in serverless environments, where the cloud
 * will manage receiving a message from the transport and passing it directly to the serverless container.
 */
export interface Receiver<
  TReceivedMessage = unknown,
  TTransportMessage extends TransportMessage<unknown> = TransportMessage<unknown>,
  TReceiveResult = unknown
> {
  /**
   * Invoked when a message is received by the application and needs to be converted into a transport message
   * so that it can be passed to the dispatcher and send to handlers.
   *
   * @param receivedMessage The message received by the app
   * @param messageSerializer The configured serializer, which can be used to deserialize the incoming message
   */
  receive(
    receivedMessage: TReceivedMessage,
    messageSerializer: MessageSerializer
  ): Promise<TTransportMessage | TTransportMessage[]>

  /**
   * Optional. When implemented, each received message is handled independently: a failing message no longer
   * makes `bus.receive()` reject straight away. Instead, once every message has been handled, this is called with
   * the ones that failed and its return value is returned by `bus.receive()`. Throw from it to fail the whole
   * batch. Messages without a handler are discarded and are not reported as failures.
   *
   * When not implemented, `bus.receive()` rejects as soon as any message fails.
   *
   * @param failures The messages that failed to be handled, and why. Empty when all succeeded.
   * @returns The value that `bus.receive()` resolves with, e.g. a partial batch response for the host.
   * @example
   * toReceiveResult(failures) {
   *   return { batchItemFailures: failures.map(f => ({ itemIdentifier: f.message.id })) }
   * }
   */
  toReceiveResult?(
    failures: ReceivedMessageFailure<TTransportMessage>[]
  ): TReceiveResult | Promise<TReceiveResult>
}
