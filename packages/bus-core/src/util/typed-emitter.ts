export interface Listener<T> {
  (event: T): any
}

export type Unsubscribe = () => void

/**
 * Called with the rejection reason when an async listener's promise rejects
 */
export type ListenerRejectedHandler = (error: unknown) => void

/**
 * An EventEmitter that emits a strongly typed event.
 *
 * Listeners are invoked synchronously. A listener that returns a promise isn't awaited, but its rejection
 * is caught and passed to `onListenerRejected` instead of becoming an unhandled rejection.
 * @see https://basarat.gitbook.io/typescript/main-1/typed-event
 */
export class TypedEmitter<T> {
  private listeners: Listener<T>[] = []
  private listenersOncer: Listener<T>[] = []

  /**
   * @param onListenerRejected Called when an async listener rejects. When not provided, rejections are ignored.
   */
  constructor(private readonly onListenerRejected?: ListenerRejectedHandler) {}

  on = (listener: Listener<T>): Unsubscribe => {
    this.listeners.push(listener)
    return () => this.off(listener)
  }

  once = (listener: Listener<T>): void => {
    this.listenersOncer.push(listener)
  }

  off = (listener: Listener<T>) => {
    const callbackIndex = this.listeners.indexOf(listener)
    if (callbackIndex > -1) this.listeners.splice(callbackIndex, 1)
  }

  emit = (event: T) => {
    // Update any general listeners
    this.listeners.forEach(listener => this.invoke(listener, event))

    // Clear the `once` queue
    if (this.listenersOncer.length > 0) {
      const toCall = this.listenersOncer
      this.listenersOncer = []
      toCall.forEach(listener => this.invoke(listener, event))
    }
  }

  pipe = (typedEmitter: TypedEmitter<T>): Unsubscribe => {
    return this.on(e => typedEmitter.emit(e))
  }

  private invoke(listener: Listener<T>, event: T): void {
    const result = listener(event)
    if (typeof result?.then === 'function') {
      // Async listeners aren't awaited, so catch rejections here rather than leave them unhandled
      Promise.resolve(result).catch(error => this.onListenerRejected?.(error))
    }
  }
}
