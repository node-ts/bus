import { MemoryQueueConfiguration } from './memory-queue-configuration'

export class DefaultMemoryQueueConfiguration implements MemoryQueueConfiguration {
  maxRetries: 10

  receiveTimeoutMs: 1000
}
