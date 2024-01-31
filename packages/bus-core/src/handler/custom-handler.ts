/**
 * A handler that handles messages defined externally to the system, that don't extend from the Message base
 */
export interface CustomHandler<TMessage = any> {
  handle(message: TMessage): void | Promise<void>
}
