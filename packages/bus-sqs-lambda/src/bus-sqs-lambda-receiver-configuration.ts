/**
 * Configuration options for the BusSqsLambdaReceiver
 */
export interface BusSqsLambdaReceiverConfiguration {
  /**
   * When true, `bus.receive()` resolves with an `SQSBatchResponse` listing the records that failed, rather than
   * rejecting, so that only the failed records are retried. The Lambda's SQS event source mapping must have
   * `ReportBatchItemFailures` enabled in its `FunctionResponseTypes`, otherwise Lambda ignores the response and
   * deletes the failed records along with the successful ones.
   *
   * @default false
   */
  reportBatchItemFailures?: boolean
}
