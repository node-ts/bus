export interface Listener<T> {
  (event: T): any
}

export type Unsubscribe = () => void

/**
 * An EventEmitter that emits a strongly typed event
 * @see https://basarat.gitbook.io/typescript/main-1/typed-event
 */
export class TypedEmitter<T> {
  private listeners: Listener<T>[] = []
  private listenersOncer: Listener<T>[] = []

  on = (listener: Listener<T>): Unsubscribe => {
    this.listeners.push(listener)
    return () => this.off(listener)
  }

  once = (listener: Listener<T>): void => {
    this.listenersOncer.push(listener)
  }

  off = (listener: Listener<T>) => {
    var callbackIndex = this.listeners.indexOf(listener)
    if (callbackIndex > -1) this.listeners.splice(callbackIndex, 1)
  }

  emit = (event: T) => {
    // Update any general listeners
    this.listeners.forEach((listener) => listener(event))

    // Clear the `once` queue
    if (this.listenersOncer.length > 0) {
      const toCall = this.listenersOncer
      this.listenersOncer = []
      toCall.forEach((listener) => listener(event))
    }
  }

  pipe = (typedEmitter: TypedEmitter<T>): Unsubscribe => {
    return this.on((e) => typedEmitter.emit(e))
  }
}
