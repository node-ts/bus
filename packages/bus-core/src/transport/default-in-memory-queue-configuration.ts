import { InMemoryQueueConfiguration } from './in-memory-queue-configuration'

export const DEFAULT_IN_MEMORY_ENDPOINT_NAME = 'in-memory'

export class DefaultInMemoryQueueConfiguration implements InMemoryQueueConfiguration {
  receiveTimeoutMs = 1000

  endpointName = DEFAULT_IN_MEMORY_ENDPOINT_NAME
}
