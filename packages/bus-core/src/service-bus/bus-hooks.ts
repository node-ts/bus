import { injectable } from 'inversify'
import { HookCallback, HookAction } from './bus'

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

  on (action: HookAction, callback: HookCallback): void {
    this.messageHooks[action].push(callback)
  }

  off (action: HookAction, callback: HookCallback): void {
    const index = this.messageHooks[action].indexOf(callback)
    if (index >= 0) {
      this.messageHooks[action].splice(index, 1)
    }
  }

  get send (): HookCallback[] {
    return this.messageHooks.send
  }

  get publish (): HookCallback[] {
    return this.messageHooks.publish
  }

  get error (): HookCallback[] {
    return this.messageHooks.error
  }
}
