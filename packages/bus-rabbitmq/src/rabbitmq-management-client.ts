import { RabbitMqManagementRequestFailed } from './error'

/**
 * A binding as the management API lists it
 */
export interface RabbitMqManagementBinding {
  /**
   * The exchange, which is `''` for the default exchange
   */
  source: string
  destination: string
  destination_type: 'queue' | 'exchange'
  routing_key: string
  arguments?: { [argument: string]: unknown }
}

/**
 * An exchange as the management API describes it
 */
export interface RabbitMqManagementExchange {
  name: string
  type: string
}

/**
 * Where the management API is, how to authenticate with it, and the vhost of the transport's connection
 */
export interface RabbitMqManagementSettings {
  /**
   * The management API's URL, without credentials or a trailing slash
   */
  baseUrl: string
  /**
   * The value of the `authorization` header
   */
  authorization: string
  vhost: string
}

/**
 * Works out how to reach the management API. The user and password come from `managementUrl` when it has a user,
 * otherwise from the AMQP `connectionString`, and default to `guest` as amqplib's do. The vhost is the path of the
 * connection string, as amqplib reads it, which is `/` when there's none.
 * @param managementUrl the URL of the management API, such as `http://rabbitmq:15672`
 * @param connectionString the AMQP URL the transport connects with
 */
export const resolveManagementSettings = (
  managementUrl: string,
  connectionString: string
): RabbitMqManagementSettings => {
  const management = new URL(managementUrl)
  const connection = new URL(connectionString)
  const credentialsFrom = management.username ? management : connection
  const hasCredentials =
    credentialsFrom.username !== '' || credentialsFrom.password !== ''
  const user = hasCredentials
    ? decodeURIComponent(credentialsFrom.username)
    : 'guest'
  const password = hasCredentials
    ? decodeURIComponent(credentialsFrom.password)
    : 'guest'
  management.username = ''
  management.password = ''
  management.search = ''
  management.hash = ''
  const vhostPath = connection.pathname.slice(1)
  return {
    baseUrl: management.href.replace(/\/+$/, ''),
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    vhost: vhostPath ? decodeURIComponent(vhostPath) : '/'
  }
}

/**
 * Reads what AMQP can't from RabbitMQ's management API, such as the bindings of a queue. It only reads.
 */
export class RabbitMqManagementClient {
  private readonly settings: RabbitMqManagementSettings

  /**
   * @param managementUrl the URL of the management API, such as `http://rabbitmq:15672`
   * @param connectionString the AMQP URL the transport connects with, for its vhost and, unless `managementUrl` has
   * them, its credentials
   */
  constructor(managementUrl: string, connectionString: string) {
    this.settings = resolveManagementSettings(managementUrl, connectionString)
  }

  /**
   * Lists the bindings whose destination is a queue, from `GET /api/queues/{vhost}/{queue}/bindings`
   * @returns the bindings, or `undefined` if the queue doesn't exist
   * @throws RabbitMqManagementRequestFailed if the API can't be reached or refuses the request
   */
  async getQueueBindings(
    queueName: string
  ): Promise<RabbitMqManagementBinding[] | undefined> {
    return this.get<RabbitMqManagementBinding[]>(
      `/queues/${encodeURIComponent(this.settings.vhost)}/${encodeURIComponent(queueName)}/bindings`
    )
  }

  /**
   * Describes an exchange, from `GET /api/exchanges/{vhost}/{exchange}`
   * @returns the exchange, or `undefined` if it doesn't exist
   * @throws RabbitMqManagementRequestFailed if the API can't be reached or refuses the request
   */
  async getExchange(
    exchangeName: string
  ): Promise<RabbitMqManagementExchange | undefined> {
    return this.get<RabbitMqManagementExchange>(
      `/exchanges/${encodeURIComponent(this.settings.vhost)}/${encodeURIComponent(exchangeName)}`
    )
  }

  /**
   * Makes a GET request to the management API
   * @returns the JSON response, or `undefined` for a 404
   */
  private async get<T>(path: string): Promise<T | undefined> {
    let response: Response
    try {
      response = await fetch(`${this.settings.baseUrl}/api${path}`, {
        headers: { authorization: this.settings.authorization }
      })
    } catch (error) {
      throw new RabbitMqManagementRequestFailed(path, undefined, error)
    }
    if (response.status === 404) {
      return undefined
    }
    if (!response.ok) {
      throw new RabbitMqManagementRequestFailed(path, response.status)
    }
    return (await response.json()) as T
  }
}
