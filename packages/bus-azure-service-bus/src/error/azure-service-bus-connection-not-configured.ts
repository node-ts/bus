/**
 * Thrown when the Azure Service Bus transport has no way to connect: no `connectionString`, no
 * `fullyQualifiedNamespace` and `credential`, and no client passed to its constructor
 */
export class AzureServiceBusConnectionNotConfigured extends Error {
  readonly help: string

  /**
   * @param client which client couldn't be created
   */
  constructor(
    readonly client: 'ServiceBusClient' | 'ServiceBusAdministrationClient'
  ) {
    super(
      `AzureServiceBusTransport can't create a ${client}, since it was configured with neither a connectionString nor a fullyQualifiedNamespace and credential`
    )
    this.help = `Set connectionString, or fullyQualifiedNamespace and credential (such as new DefaultAzureCredential() from @azure/identity), in the AzureServiceBusTransportConfiguration. Or pass your own ${client} to the AzureServiceBusTransport constructor.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
