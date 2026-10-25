/**
 * Thrown when a request to RabbitMQ's management API fails, such as when the user isn't allowed to make it
 */
export class RabbitMqManagementRequestFailed extends Error {
  readonly help: string

  /**
   * @param path the path of the request, under the management API's `/api`
   * @param status the HTTP status the API responded with, or `undefined` if it couldn't be reached
   * @param cause why it couldn't be reached, when it couldn't
   */
  constructor(
    readonly path: string,
    readonly status: number | undefined,
    readonly cause?: unknown
  ) {
    super(
      status === undefined
        ? `RabbitMQ's management API couldn't be reached for GET /api${path}: ${cause instanceof Error ? cause.message : String(cause)}`
        : `RabbitMQ's management API responded to GET /api${path} with ${status}`
    )
    this.help =
      status === 401 || status === 403
        ? 'Give the user the management tag and access to the vhost, or put the credentials of a user that has them in managementUrl, such as `http://deployer:secret@rabbitmq:15672`.'
        : 'Check that managementUrl points at the management API of the broker in connectionString, with the management plugin enabled.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
