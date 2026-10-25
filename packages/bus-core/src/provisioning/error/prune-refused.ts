/**
 * Why a bus can't be pruned: it's send-only or a scheduler, so it has no queue of its own, it handles no message
 * through a topic or exchange, or it has a custom handler whose subscription was made outside the bus
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
    "has a custom handler without a topicIdentifier, whose subscription or binding was made outside the bus, so pruning can't tell it's still needed"
}

const HELP: { [reason in PruneRefusalReason]: string } = {
  'send-only':
    'Prune the configuration of the service that receives through the queue, built without asSendOnly().',
  scheduler:
    'Prune the configuration of the service that receives through the queue, built without asScheduler().',
  'handles-nothing':
    "Check that the module registers the bus' handlers and workflows. If the service really no longer handles any message, pass `allowEmpty: true` to bus.prune(), or --allow-empty to `bus prune`.",
  'custom-handler-without-topic':
    'Pass the topic or exchange the custom handler receives from as the topicIdentifier of withCustomHandler(), so the bus knows its subscription or binding is needed (provisioning then subscribes the queue to it too). Remove orphaned subscriptions of this queue by hand until then.'
}

/**
 * Thrown by `bus.prune()` when pruning the bus could remove what it shouldn't: a send-only bus or a scheduler has no
 * queue of its own, a bus that handles nothing would lose every subscription or binding of its queue unless it's
 * pruned with `allowEmpty`, and the subscription of a custom handler without a `topicIdentifier` can't be told apart
 * from an orphaned one
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
