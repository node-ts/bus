/**
 * Native headers for a transport to send with a message, set by outgoing middleware. Each transport writes them in
 * its own way, such as AMQP headers on RabbitMQ or SNS message attributes on SQS.
 */
export type TransportHeaders = Record<string, string | number | boolean>

/**
 * Options for how a transport sends or publishes one message, beyond its attributes
 */
export interface TransportSendOptions {
  /**
   * Native headers to send with the message, as set by outgoing middleware. A transport throws
   * `TransportHeaderReserved` for a name it uses itself.
   */
  headers?: TransportHeaders
}
