import { InMemoryQueueConfiguration } from './in-memory-queue-configuration'

export class DefaultInMemoryQueueConfiguration
  implements InMemoryQueueConfiguration
{
  maxRetries = 10

  receiveTimeoutMs = 1000
}
