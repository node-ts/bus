/**
 * Why a bus can't be pruned: it's send-only or a scheduler, so it has no queue of its own, it handles no message
 * through a topic or exchange, or it has a custom handler whose messages may arrive through a subscription made
 * outside the bus
 */
export type PruneRefusalReason =
  'send-only' | 'scheduler' | 'handles-nothing' | 'custom-handler-without-topic'

const MESSAGES: { [reason in PruneRefusalReason]: string } = {
  'send-only':
    'is send-only, so it has no queue of its own whose subscriptions or bindings could be pruned',
  scheduler:
    'is a scheduler, so it has no queue of its own whose subscriptions or bindings could be pruned',
  'handles-nothing':
    'handles no message through a topic or exchange, so pruning would remove every subscription or binding of its queue',
  'custom-handler-without-topic':
    "has a custom handler without a topicIdentifier, so pruning can't tell whether its messages arrive through a subscription or binding made outside the bus, which would look like one the bus no longer needs"
}

const HELP: { [reason in PruneRefusalReason]: string } = {
  'send-only':
    'Prune the configuration of the service that receives through the queue, built without asSendOnly().',
  scheduler:
    'Prune the configuration of the service that receives through the queue, built without asScheduler().',
  'handles-nothing':
    "Check that the module registers the bus' handlers and workflows. If the service really no longer handles any message, pass `allowEmpty: true` to bus.prune(), or --allow-empty to `bus prune`.",
  'custom-handler-without-topic':
    'If the custom handler receives from a topic or exchange the queue was subscribed or bound to by hand, pass it as the topicIdentifier of withCustomHandler(), so pruning keeps that subscription or binding (provisioning then subscribes the queue to it too). If its messages are sent straight to the queue instead, such as S3 event notifications or messages another system sends to it, there is nothing to keep: pass `allowCustomHandlersWithoutTopic: true` to bus.prune(), or --allow-custom-handlers to `bus prune`. Any subscription or binding made by hand for a handler without a topicIdentifier is then removed.'
}

/**
 * Thrown by `bus.prune()` when pruning the bus could remove what it shouldn't: a send-only bus or a scheduler has no
 * queue of its own, a bus that handles nothing would lose every subscription or binding of its queue unless it's
 * pruned with `allowEmpty`, and the subscription of a custom handler without a `topicIdentifier` can't be told apart
 * from an orphaned one unless it's pruned with `allowCustomHandlersWithoutTopic`
 */
export class PruneRefused extends Error {
  readonly help: string

  /**
   * @param endpointName the name of the bus' queue, from its transport
   * @param reason why the bus can't be pruned
   */
  constructor(
    readonly endpointName: string,
    readonly reason: PruneRefusalReason
  ) {
    super(
      `The bus of ${endpointName || 'the transport'} can't be pruned, since it ${MESSAGES[reason]}`
    )
    this.help = HELP[reason]

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
