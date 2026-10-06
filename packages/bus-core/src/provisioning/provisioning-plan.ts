/**
 * A value that can be written as JSON as it is
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * One piece of infrastructure an adapter creates when it provisions, such as a topic, a queue or a table
 */
export interface ProvisionedResource {
  /**
   * The kind of resource, named by the adapter in kebab case
   * @example sqs-queue
   */
  type: string

  /**
   * The resource's name or identifier, such as its ARN
   * @example arn:aws:sqs:us-east-1:123456789012:orders
   */
  name: string

  /**
   * The settings the adapter creates the resource with, such as a queue's attributes, or what a binding or
   * subscription connects
   */
  properties?: { [property: string]: JsonValue }
}

/**
 * The permissions an adapter needs at runtime, once its resources have been provisioned, in the form its
 * infrastructure uses
 */
export interface RuntimePermissions {
  /**
   * What `document` is
   * @example iam-policy
   */
  format: string

  /**
   * The permissions, such as an IAM policy document or a list of SQL grants
   */
  document: JsonValue
}

/**
 * What one adapter (a transport or a persistence) provisions for a bus. `bus.provision()` returns one for each
 * adapter that provisions anything.
 */
export interface ProvisioningPlan {
  /**
   * The class name of the adapter
   * @example SqsTransport
   */
  adapter: string

  /**
   * Every resource the adapter makes sure exists. Provisioning is idempotent, so this lists resources that
   * already existed too.
   */
  resources: ProvisionedResource[]

  /**
   * The least the adapter needs at runtime, including the read-only calls `initialize()` makes to check its
   * resources exist
   */
  runtimePermissions?: RuntimePermissions
}

/**
 * How `bus.provision()` runs
 */
export interface ProvisionOptions {
  /**
   * Works out the plan without connecting to anything or changing anything
   * @default false
   */
  dryRun?: boolean
}
