// The names of the spans, metrics and attributes this package records, in one place. The OpenTelemetry messaging
// conventions aren't stable yet, so they're pinned to one version: the names below were checked against
// `@opentelemetry/semantic-conventions@1.43.0`. Moving to a newer version means updating this file, the schema url
// and the docs page (docs/guide/opentelemetry.md), and calling out any renamed metric in the changeset, since it
// breaks dashboards and alerts.
//
// Names that start `node_ts_bus.` are this package's own, for what the conventions don't cover.

/**
 * The version of the OpenTelemetry semantic conventions the names in this file follow
 */
export const SEMANTIC_CONVENTIONS_VERSION = '1.43.0'

/**
 * The schema url of the pinned conventions, which the tracer and meter report
 */
export const SCHEMA_URL = `https://opentelemetry.io/schemas/${SEMANTIC_CONVENTIONS_VERSION}`

/**
 * The instrumentation scope the tracer and meter are created with
 */
export const INSTRUMENTATION_SCOPE = '@node-ts/bus-opentelemetry'

/**
 * The `messaging.system` when none is configured. The conventions have no value for the in-memory queue, and the bus
 * can't tell which broker a transport uses.
 */
export const DEFAULT_MESSAGING_SYSTEM = 'node_ts_bus'

export const ATTR_MESSAGING_SYSTEM = 'messaging.system'
export const ATTR_MESSAGING_OPERATION_NAME = 'messaging.operation.name'
export const ATTR_MESSAGING_OPERATION_TYPE = 'messaging.operation.type'
export const ATTR_MESSAGING_DESTINATION_NAME = 'messaging.destination.name'
export const ATTR_MESSAGING_MESSAGE_ID = 'messaging.message.id'
export const ATTR_MESSAGING_MESSAGE_CONVERSATION_ID =
  'messaging.message.conversation_id'
export const ATTR_ERROR_TYPE = 'error.type'

/**
 * The `$name` of the message, on every span and metric. On a process span the destination is the queue, so this is
 * what tells one message type from another.
 */
export const ATTR_MESSAGE_NAME = 'node_ts_bus.message.name'

/**
 * The name of the handler or workflow, on handler spans
 */
export const ATTR_HANDLER_NAME = 'node_ts_bus.handler.name'

/**
 * `error.type` when what was thrown isn't an `Error`
 */
export const ERROR_TYPE_VALUE_OTHER = '_OTHER'

/**
 * `messaging.operation.type` of a send or publish. The conventions deprecated `publish` as a type in favour of
 * `send`; `messaging.operation.name` keeps telling the two apart.
 */
export const OPERATION_TYPE_SEND = 'send'

/**
 * `messaging.operation.type` and `messaging.operation.name` of handling a received message
 */
export const OPERATION_PROCESS = 'process'

/**
 * Histogram of how long handling a received message took, in seconds, including every handler
 */
export const METRIC_MESSAGING_PROCESS_DURATION = 'messaging.process.duration'

/**
 * Counter of messages sent or published
 */
export const METRIC_MESSAGING_CLIENT_SENT_MESSAGES =
  'messaging.client.sent.messages'

/**
 * Counter of messages received and passed to the handlers
 */
export const METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES =
  'messaging.client.consumed.messages'

/**
 * Counter of messages whose handling failed, so they were returned to the queue
 */
export const METRIC_FAILED_MESSAGES = 'node_ts_bus.failed.messages'

/**
 * Histogram of the time from when a message was sent until it was handled, in seconds
 */
export const METRIC_CRITICAL_TIME = 'node_ts_bus.critical_time'
