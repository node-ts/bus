/**
 * Represents the lifecycle state of a message-handling bus instance
 */
export enum BusState {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped'
}
