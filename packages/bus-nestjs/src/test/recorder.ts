import { EventEmitter } from 'node:events'

/**
 * What a test handler recorded
 */
export interface Recording {
  /**
   * The handler or workflow that recorded it
   */
  by: string
  /**
   * The message it handled
   */
  message: object
  /**
   * Anything else it recorded, such as the request-scoped provider it was given
   */
  detail?: unknown
}

/**
 * A provider the test handlers record what they handle with, so a test can wait for and check them
 */
export class Recorder {
  readonly recordings: Recording[] = []
  private readonly events = new EventEmitter()

  record(recording: Recording): void {
    this.recordings.push(recording)
    this.events.emit('recorded')
  }

  /**
   * Waits until at least `count` recordings were made
   */
  async waitFor(count: number): Promise<Recording[]> {
    while (this.recordings.length < count) {
      await new Promise(resolve => this.events.once('recorded', resolve))
    }
    return this.recordings
  }

  /**
   * The recordings made by one handler or workflow
   */
  by(name: string): Recording[] {
    return this.recordings.filter(recording => recording.by === name)
  }
}
