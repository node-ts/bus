import { injectable } from 'inversify'
import { HookCallback, HookAction, ErrorHookCallback, StandardHookCallback } from './bus'

/**
 * A singleton repository for all hook events registered with the Bus. This persists across scope boundaries
 * so that Bus instances that are scoped to a message handling context still have access to the global set
 * of registered hooks
 *
 * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
 * @example BusHooks<InMemoryMessage>
 * @example BusHooks<SQS.Message>
 */
@injectable()
export class BusHooks<TransportMessageType = unknown> {
  private messageHooks: { [key: string]: HookCallback<TransportMessageType>[] } = {
    send: [],
    publish: [],
    error: []
  }

  on (action: Extract<HookAction, 'error'>, callback: ErrorHookCallback<TransportMessageType>): void
  on (action: Exclude<HookAction, 'error'>, callback: StandardHookCallback): void
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
