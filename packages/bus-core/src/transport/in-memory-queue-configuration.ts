export interface InMemoryQueueConfiguration {
  /**
   * Maximum number of attempts to retry a failed message before routing it to the DLQ
   */
  maxRetries: number

  /**
   * The number of milliseconds to wait whilst attempting to read the next message
   */
  receiveTimeoutMs: number

  /**
   * The name the queue reports as its `endpointName`. Give each in-memory bus its own name when more than one runs in
   * a process and something needs to tell them apart.
   * @default in-memory
   */
  endpointName?: string
}
