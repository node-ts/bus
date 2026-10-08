import { MessageAttributes } from '@node-ts/bus-messages'

/**
 * What a request-scoped provider gets when it injects Nest's `REQUEST` while the bus resolves it to handle a
 * message: the message and its attributes. Each received message has its own request scope, shared by every class
 * handler and workflow that handles it.
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
