/**
 * The JSON `bus provision --json` prints. Fields are only added to it, never renamed or removed, unless
 * `formatVersion` changes.
 */
export interface ProvisionReport {
  /**
   * The version of this format
   */
  formatVersion: 1

  /**
   * Whether it was a dry run, so nothing was created
   */
  dryRun: boolean

  /**
   * What each transport or persistence of the bus that provisions anything provisioned, in the order they ran
   */
  adapters: ProvisionReportAdapter[]
}

/**
 * What one transport or persistence provisioned
 */
export interface ProvisionReportAdapter {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Every resource the adapter makes sure exists, including those that already did
   */
  resources: ProvisionReportResource[]

  /**
   * The least the adapter needs at runtime. Only included with `--permissions`.
   */
  runtimePermissions?: {
    /**
     * What `document` is: `iam-policy` (an IAM policy document), `rabbitmq-permissions` (`configure`, `write` and
     * `read` regular expressions for the vhost), `sql` (a list of grant statements) or `mongodb-privileges` (the
     * privileges of a role)
     */
    format: string
    document: unknown
  }
}

/**
 * One resource an adapter makes sure exists
 */
export interface ProvisionReportResource {
  /**
   * The kind of resource, such as `sns-topic`, `sqs-queue`, `rabbitmq-exchange` or `postgres-table`
   */
  type: string

  /**
   * Its name or identifier, such as its ARN
   */
  name: string

  /**
   * The settings it's created with
   */
  properties?: { [property: string]: unknown }
}
