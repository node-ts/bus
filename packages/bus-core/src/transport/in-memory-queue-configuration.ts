export interface InMemoryQueueConfiguration {
  /**
   * Maximum number of attempts to retry a failed message before routing it to the DLQ
   */
  maxRetries: number

  /**
   * The number of milliseconds to wait whilst attempting to read the next message
   */
  receiveTimeoutMs: number
}
