import { MessageAttributes } from '@node-ts/bus-messages'

/**
 * What a request-scoped provider gets when it injects Nest's `REQUEST` while the bus resolves it to handle a
 * message: the message and its attributes. Each received message has its own request scope, shared by every class
 * handler and workflow that handles it.
 *
 * A request-scoped class workflow is also resolved once without a message, when the bus reads its
 * `configureWorkflow()`, so `REQUEST` is `undefined` then.
 * @example
 * ```ts
 * @Injectable({ scope: Scope.REQUEST })
 * export class TenantRepository {
 *   constructor(@Inject(REQUEST) private readonly request: BusRequest) {}
 * }
 * ```
 */
export interface BusRequest {
  /**
   * The message being handled
   */
  message: object
  /**
   * The message's attributes
   */
  attributes: MessageAttributes | undefined
}
