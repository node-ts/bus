/**
 * Thrown by `prune()` when the transport isn't configured with the URL of RabbitMQ's management API, which it needs to
 * list the bindings of its queue, since AMQP can't
 */
export class RabbitMqManagementUrlMissing extends Error {
  readonly help: string

  /**
   * @param queueName the name of the service queue whose bindings would be listed
   */
  constructor(readonly queueName: string) {
    super(
      `RabbitMqTransport can't prune the bindings of the queue ${queueName}, since it isn't configured with a managementUrl`
    )
    this.help =
      "Set managementUrl in the RabbitMqTransportConfiguration to the broker's management API, such as `http://rabbitmq:15672`, with the management plugin enabled. Its user and vhost come from connectionString unless the URL has a user of its own, and the user needs the management tag and access to the vhost."

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
