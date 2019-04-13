export const BUS_SQS_SYMBOLS = {
  SqsConfiguration: Symbol.for('node-ts/bus-sqs/transport-configuration')
}

export const BUS_SQS_INTERNAL_SYMBOLS = {
  SqsTransport: Symbol.for('node-ts/bus-sqs/sqs-transport'),
  Sqs: Symbol.for('node-ts/bus-sqs/sqs'),
  Sns: Symbol.for('node-ts/bus-sqs/sns')
}
