// Stands in for the client library of the broker a transport adapts. It isn't
// shown on the site.

/**
 * A message as the broker delivers it
 */
export interface BrokerMessage {
  id: string
  body: string
  headers: Record<string, string>
  /**
   * How many times the broker has delivered the message
   */
  deliveryCount: number
}

export interface BrokerClient {
  connect(): Promise<void>
  close(): Promise<void>
  createQueue(queue: string): Promise<void>
  subscribe(queue: string, topic: string): Promise<void>
  publish(
    topic: string,
    body: string,
    headers: Record<string, string>
  ): Promise<void>
  receive(queue: string): Promise<BrokerMessage | undefined>
  ack(queue: string, messageId: string): Promise<void>
  retry(queue: string, messageId: string, delayMs: number): Promise<void>
  moveTo(queue: string, message: BrokerMessage): Promise<void>
  readAll(queue: string): Promise<BrokerMessage[]>
}

export declare const brokerClient: BrokerClient
