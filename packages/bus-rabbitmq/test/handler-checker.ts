import { MessageAttributes } from '@node-ts/bus-messages'

export const HANDLE_CHECKER = Symbol.for('node-ts/bus-rabbitmq/integration/handle-checker')
export interface HandleChecker {
  check<T extends object> (message: T, attributes: MessageAttributes): void
}
