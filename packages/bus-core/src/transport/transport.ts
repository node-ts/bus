import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { HandlerRegistry } from '../handler'
import { ProvisioningPlan } from '../provisioning'
import { MessageFailure } from '../recoverability'
import { CoreDependencies, Milliseconds } from '../util'
import { TransportMessage } from './transport-message'
import { TransportSendOptions } from './transport-send-options'

export interface TransportInitializationOptions {
  /**
   * The handler registry that contains all of the message handlers that the transport needs to
   * subscribe to.
   */
  handlerRegistry: HandlerRegistry

  /**
   * If the transport is being initialized in send-only mode
   */
  sendOnly: boolean

  /**
   * The `$name` of every message the bus handles or has message types for (see `withMessageTypes()`), without
   * workflow state. A transport that routes each message through its own topic or exchange provisions one for
   * each of these, and checks they exist.
   */
  messageNames: string[]

  /**
   * Whether to check that every resource the transport needs exists, such as its queue, topics and
   * subscriptions, and throw `ResourcesNotProvisioned` if any don't. Use read-only calls, and create nothing.
   * It's `false` when the bus was configured with `withResourceVerification(false)`, or has just provisioned.
   */
  verifyResources: boolean

  /**
   * Whether the bus was configured with `withAutoProvision()`, and so has just called `provision()`. Only then may
   * the transport create resources it finds it needs later, such as the topic of a message sent that isn't in the
   * bus' message types. Otherwise it must create nothing at runtime.
   */
  autoProvision: boolean
}

export interface TransportProvisionOptions {
  /**
   * The handler registry that contains all of the message handlers that the transport needs to subscribe to
   */
  handlerRegistry: HandlerRegistry

  /**
   * If the bus only sends, so it needs no queue or subscriptions
   */
  sendOnly: boolean

  /**
   * The `$name` of every message the bus handles or has message types for, without workflow state. A transport
   * that routes each message through its own topic or exchange provisions one for each of these, so senders and
   * receivers can be deployed in any order.
   */
  messageNames: string[]

  /**
   * Whether the bus may send messages of any type, not only those in `messageNames`, such as a scheduler
   * (`asScheduler()`), which sends the scheduled messages of every service that shares its persistence. Its runtime
   * permissions then allow publishing to any topic or exchange.
   */
  sendsAnyMessage: boolean

  /**
   * Only work out the plan, without connecting to the broker or changing anything
   */
  dryRun: boolean
}

export interface TransportConnectionOptions {
  concurrency: number
}

/**
 * A transport adapter interface that enables the service bus to use a messaging technology.
 */
export interface Transport<TransportMessageType = {}> {
  /**
   * The name of the endpoint the bus runs as, which is the name of the queue it receives from. It identifies the
   * service, for example in failure metadata or when deduplicating messages, so it should be stable across restarts
   * and the same on every instance of the service. A send-only transport that isn't configured with a queue may
   * return `''`.
   * @example order-booking-service
   */
  readonly endpointName: string

  /**
   * The address that replies to this endpoint are sent to. The bus stamps it on every message it sends, unless it's
   * send-only, as the `replyTo` attribute, and `ctx.reply()` passes it to the replying transport's `sendToAddress()`.
   * It must reach this endpoint's queue from any service the endpoint talks to, so a transport whose queue names
   * aren't enough to find a queue, such as SQS with queues in other accounts or regions, returns a full address such
   * as the queue URL. Leave it out to use `endpointName`.
   * @default endpointName
   * @example https://sqs.us-east-1.amazonaws.com/123456789012/order-booking-service
   */
  readonly returnAddress?: string

  /**
   * Publishes an event to the underlying transport. This is generally done to a topic or some other
   * mechanism that consumers can subscribe themselves to
   * @param event A domain event to be published
   * @param messageOptions Options that control the behaviour around how the message is sent and
   * additional information that travels with it.
   * @param sendOptions How to send this message, such as the native headers set by outgoing middleware
   * @throws TransportHeaderReserved if a header in `sendOptions` has a name the transport uses itself
   */
  publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void>

  /**
   * Sends a command to the underlying transport. This is generally done to a topic or some other
   * mechanism that consumers can subscribe themselves to
   * @param command A domain command to be sent
   * @param messageOptions Options that control the behaviour around how the message is sent and
   * additional information that travels with it.
   * @param sendOptions How to send this message, such as the native headers set by outgoing middleware
   * @throws TransportHeaderReserved if a header in `sendOptions` has a name the transport uses itself
   */
  send<TCommand extends Command>(
    command: TCommand,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void>

  /**
   * Sends a message straight to the queue at a return address, bypassing the topics or exchanges that `send()` and
   * `publish()` route by, so the message isn't delivered through any subscription and only that queue receives it.
   * The bus calls it for `ctx.reply()`, with the return address (`replyTo` attribute) of the message being handled.
   *
   * Write the message and its attributes as `send()` does, including `replyTo`, so the receiving transport reads
   * it like any other message. A transport that doesn't implement it can't be used with `ctx.reply()`, which throws
   * `TransportReplyNotSupported`.
   * @param address the return address to send to, which is the `returnAddress` (or `endpointName`) of the
   * transport that reads the queue
   * @param message the command or event to send
   * @param messageAttributes Options that control the behaviour around how the message is sent and additional
   * information that travels with it
   * @param sendOptions How to send this message, such as the native headers set by outgoing middleware
   * @throws TransportHeaderReserved if a header in `sendOptions` has a name the transport uses itself
   * @throws EndpointNotFound if the transport finds there's no queue at `address`, which retrying can't fix
   * @example
   * await transport.sendToAddress('orders-service', new CreditChecked('order-1', true), attributes)
   */
  sendToAddress?(
    address: string,
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void>

  /**
   * An optional check of the options a message will be sent with. The bus calls it as soon as `send()` or
   * `publish()` is called, after the outgoing middleware has set the headers and before the message is buffered in
   * a handler's outbox or sent. That way the caller's `send()` or `publish()` rejects, instead of the outbox failing
   * when it's flushed after the handler's other messages have gone out. A transport that writes headers natively
   * should implement it, and still check in `send()` and `publish()`, which may be called directly.
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header has a name the transport uses itself
   */
  assertSendOptions?(sendOptions: TransportSendOptions): void

  /**
   * Moves a message to the dead letter queue and removes it from the service queue, so it isn't handled again. The
   * bus calls it when its recoverability policy dead-letters a message, or a handler called `failMessage()`, instead
   * of `deleteMessage()` or `returnMessage()`.
   *
   * Write `failure` on the dead-lettered copy as one header named `bus-failure` (`FAILURE_HEADER`), serialized with
   * `toFailureHeader()`, keeping the message's other headers and attributes. A transport should reserve that name, so
   * `assertSendOptions` rejects it.
   * @param transportMessage the message to dead-letter, as it was read from the queue
   * @param failure why and where it failed
   */
  fail(
    transportMessage: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void>

  /**
   * Fetch the next message from the underlying queue. If there are no messages, then `undefined`
   * should be returned.
   *
   * Return a new `TransportMessage` object for each delivery, including each retry of a message that was returned to
   * the queue. The bus freezes it while it's handled, and container adapters scope what they resolve to it.
   *
   * @returns The message construct from the underlying transport, that includes both the raw message envelope
   * plus the contents or body that contains the `@node-ts/bus-messages` message.
   */
  readNextMessage(): Promise<TransportMessage<TransportMessageType> | undefined>

  /**
   * Removes a message from the underlying transport. This will be called once a message has been
   * successfully handled by any of the message handling functions.
   * @param message The message to be removed from the transport
   */
  deleteMessage(message: TransportMessage<TransportMessageType>): Promise<void>

  /**
   * Returns a message to the queue to be handled again after `delay`, counting one more failed attempt. The bus calls
   * it when handling the message failed and its recoverability policy decided to retry it. The transport doesn't
   * decide when a message has run out of attempts; the bus does, and calls `fail()` instead.
   *
   * The next time the message is read, its `failedAttempts` must be one more than it was. A delay the transport can't
   * honour exactly, such as below SQS's one second resolution, is rounded to the nearest it supports.
   * @param message The message to be returned to the queue for reprocessing
   * @param delay how long to wait before the message can be read again, in milliseconds
   */
  returnMessage(
    message: TransportMessage<unknown>,
    delay: Milliseconds
  ): Promise<void>

  /**
   * An optional function that is called before startup that will provide core dependencies
   * to the transport. This can be used to fetch loggers, registries etc that are used
   * in initialization steps
   * @param coreDependencies
   */
  prepare(coreDependencies: CoreDependencies): void

  /**
   * An optional function that will be called on startup. This gives a chance for the transport
   * to establish any connections to the underlying infrastructure.
   */
  connect?(options: TransportConnectionOptions): Promise<void>

  /**
   * An optional function that will be called on shutdown. This gives a chance for the transport
   * to close any connections to the underlying infrastructure.
   */
  disconnect?(): Promise<void>

  /**
   * An optional method called on the transport when it should start consuming messages.
   */
  start?(): Promise<void>

  /**
   * An optional method called on the transport when it should no longer consume messages.
   */
  stop?(): Promise<void>

  /**
   * An optional function that will be called when the service bus is starting, after `connect()`. It must not
   * create anything: when `verifyResources` is set, it checks the queues, topics and subscriptions the bus needs
   * exist, with read-only calls, and throws `ResourcesNotProvisioned` naming each one that's missing.
   * @param options the messages the bus handles and sends, and whether to check its resources
   * @throws ResourcesNotProvisioned if `verifyResources` is set and a resource the bus needs doesn't exist
   */
  initialize?(options: TransportInitializationOptions): Promise<void>

  /**
   * Creates everything the bus needs on the broker, such as its queue, dead letter queue, a topic or exchange for
   * each message, the subscriptions of its queue and the queue's access policy. It's run with deploy credentials
   * by `bus.provision()` (and `bus provision` from @node-ts/bus-cli), or when the bus initializes if it's
   * configured with `withAutoProvision()`, after `connect()` unless it's a dry run.
   *
   * It must be idempotent: running it again, or from several processes at once, leaves what exists as it is
   * and creates what's missing.
   * @param options the messages the bus handles and sends, and whether it's a dry run
   * @returns what the transport provisions, and the permissions it needs at runtime
   * @example
   * const plan = await transport.provision({ handlerRegistry, sendOnly: false, messageNames, dryRun: true })
   */
  provision?(options: TransportProvisionOptions): Promise<ProvisioningPlan>

  /**
   * An optional function that will be called when the service bus is shutting down. This is an
   * opportunity for the transport to close out any open requests to fetch messages etc.
   */
  dispose?(): Promise<void>
}
