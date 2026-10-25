/**
 * Thrown by `provision()` when the namespace is on the Basic tier, which has no topics or automatic forwarding
 */
export class AzureServiceBusTierNotSupported extends Error {
  readonly help: string

  /**
   * @param namespace the name of the namespace
   * @param tier the tier Service Bus reported for it
   */
  constructor(
    readonly namespace: string,
    readonly tier: string
  ) {
    super(
      `AzureServiceBusTransport can't provision the Service Bus namespace ${namespace}, since it's on the ${tier} tier, which has no topics or automatic forwarding`
    )
    this.help = `Use a namespace on the Standard or Premium tier. The transport sends each message to a topic and forwards it from a subscription into the service queue, and the Basic tier supports neither.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
