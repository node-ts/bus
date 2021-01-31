import { injectable } from 'inversify'

export interface BusConfiguration {
  /**
   * The number of messages to handle in parallel
   */
  readonly concurrency: number
}

@injectable()
export class DefaultBusConfiguration implements BusConfiguration {
  readonly concurrency: number = 1
}
