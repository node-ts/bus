/**
 * Clears the message types registered on `globalThis`, so each test starts without any
 */
export const resetMessageTypes = (): void => {
  delete (globalThis as { [key: symbol]: unknown })[
    Symbol.for('@node-ts/bus/message-types')
  ]
}
