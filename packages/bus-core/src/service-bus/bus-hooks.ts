import { injectable } from 'inversify'
import { HookCallback, HookAction, ErrorHookCallback, StandardHookCallback } from './bus'

/**
 * A singleton repository for all hook events registered with the Bus. This persists across scope boundaries
 * so that Bus instances that are scoped to a message handling context still have access to the global set
 * of registered hooks
 */
@injectable()
export class BusHooks {
  private messageHooks: { [key: string]: HookCallback[] } = {
    send: [],
    publish: [],
    error: []
  }

  on (action: Extract<HookAction, 'error'>, callback: ErrorHookCallback): void
  on (action: Exclude<HookAction, 'error'>, callback: StandardHookCallback): void
  on (action: HookAction, callback: HookCallback): void {
    this.messageHooks[action].push(callback)
  }

  off (action: HookAction, callback: HookCallback): void {
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

  get error (): ErrorHookCallback[] {
    return this.messageHooks.error as ErrorHookCallback[]
  }
}
