import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { TransportMessage } from '../transport'

export type HookAction = 'send' | 'publish' | 'error'

export type StandardHookCallback = (
  message: Message,
  messageAttributes?: MessageAttributes
) => Promise<void> | void

export type ErrorHookCallback<TransportMessageType> = (
  message: Message,
  error: Error,
  messageAttributes?: MessageAttributes,
  rawMessage?: TransportMessage<TransportMessageType>
) => Promise<void> | void

export type HookCallback<TransportMessageType> = StandardHookCallback | ErrorHookCallback<TransportMessageType>


/**
 * A singleton repository for all hook events registered with the Bus. This persists across scope boundaries
 * so that Bus instances that are scoped to a message handling context still have access to the global set
 * of registered hooks
 *
 * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
 * @example BusHooks<InMemoryMessage>
 * @example BusHooks<SQS.Message>
 */
export class BusHooks<TransportMessageType = any> {
  private messageHooks: { [key: string]: HookCallback<TransportMessageType>[] } = {
    send: [],
    publish: [],
    error: []
  }

  on (action: HookAction, callback: HookCallback<TransportMessageType>): void {
    this.messageHooks[action].push(callback)
  }

  off (action: HookAction, callback: HookCallback<TransportMessageType>): void {
    const index = this.messageHooks[action].indexOf(callback)
    if (index >= 0) {
      this.messageHooks[action].splice(index, 1)
    }
  }

  get send (): StandardHookCallback[] {
    return this.messageHooks.send as StandardHookCallback[]
  }

  get publish (): StandardHookCallback[] {
    return this.messageHooks.publish as StandardHookCallback[]
  }

  get error (): ErrorHookCallback<TransportMessageType>[] {
    return this.messageHooks.error as ErrorHookCallback<TransportMessageType>[]
  }
}
