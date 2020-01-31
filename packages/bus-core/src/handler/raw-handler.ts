/**
 * A handler that receives raw messages. Domain messages should instead use @see Handler
 * @param message A message that has been received from the bus and passed to the handler for processing
 * @returns An awaitable promise that resolves when the handler operation has completed
 */
export interface RawHandler<TMessage> {
  handle (message: TMessage): Promise<void>
}
