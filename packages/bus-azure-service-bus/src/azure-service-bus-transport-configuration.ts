import type { TokenCredential } from '@azure/service-bus'
import { TransportConfiguration } from '@node-ts/bus-core'

/**
 * How the Azure Service Bus transport connects, names its entities and receives messages. Give either a
 * `connectionString`, or a `fullyQualifiedNamespace` and a `credential`, unless you pass your own clients to the
 * transport's constructor.
 */
export interface AzureServiceBusTransportConfiguration extends TransportConfiguration {
  /**
   * The name of the queue the service receives from. It's also the name of its subscription on each topic it handles,
   * shortened and hashed when it's longer than Service Bus' 50 characters for subscription names.
   * @example order-booking-service
   */
  queueName: string

  /**
   * The name of the queue that dead-lettered messages end up in. Each service queue and subscription forwards its own
   * dead letters to it, so it's shared by every service that uses the same name.
   * @default dead-letter
   */
  deadLetterQueueName?: string

  /**
   * A connection string for the namespace, with a shared access policy that has the rights the transport needs: Send
   * and Listen at runtime, and Manage to provision.
   * @example Endpoint=sb://my-namespace.servicebus.windows.net/;SharedAccessKeyName=orders;SharedAccessKey=...
   */
  connectionString?: string

  /**
   * The host name of the namespace, used with `credential` instead of a connection string
   * @example my-namespace.servicebus.windows.net
   */
  fullyQualifiedNamespace?: string

  /**
   * A Microsoft Entra ID credential for `fullyQualifiedNamespace`, such as `new DefaultAzureCredential()` from
   * `@azure/identity`, whose identity has the Service Bus roles in the provisioning plan's runtime permissions
   */
  credential?: TokenCredential

  /**
   * How long a received message stays locked to this service before Service Bus delivers it again, as an ISO 8601
   * duration of at most 5 minutes. The transport renews the lock while a message is being handled (see
   * `maxAutoLockRenewalDurationInMs`), so this mostly sets how soon a message held by a process that died is
   * delivered again. `provision()` sets it on the service queue.
   * @default PT1M
   */
  lockDuration?: string

  /**
   * How long the transport keeps renewing the lock of a message it has received, in milliseconds. A handler that runs
   * longer than this loses the lock, and the message is delivered again. `0` turns renewal off.
   * @default 300000 (5 minutes)
   */
  maxAutoLockRenewalDurationInMs?: number

  /**
   * How many times Service Bus delivers a message from the service queue before it dead-letters it itself. The bus'
   * recoverability policy decides when a failed message is dead-lettered, and each retry is a new copy of the
   * message, so this is only a backstop for a message that crashes the process before the bus can settle it. Such a
   * message reaches the dead letter queue without failure metadata. `provision()` sets it on the service queue.
   * @default 10
   */
  maxDeliveryCount?: number

  /**
   * Maps a message name to the name of its topic. The default replaces each character Service Bus doesn't allow in
   * entity names with `-`, after dropping a leading `@`, and shortens and hashes a name over 260 characters.
   * @param messageName the `$name` of the message
   * @returns the topic name, which every service that sends or handles the message must resolve the same way
   * @example
   * resolveTopicName: messageName => `production.${resolveTopicName(messageName)}`
   */
  resolveTopicName?: (messageName: string) => string

  /**
   * Whether `initialize()` also checks, with the administration client, that the dead letter queue and the
   * subscription of each topic the service handles exist. Reading them needs the Manage right (or the Azure Service
   * Bus Data Owner role), which a service shouldn't usually have at runtime, so by default only the service queue is
   * checked, with a peek that only needs Listen.
   * @default false
   */
  verifySubscriptions?: boolean
}
