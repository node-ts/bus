import { Event, Command, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { Transport, TransportMessage, BUS_SYMBOLS, MessageSerializer } from '@node-ts/bus-core'
import { inject, injectable } from 'inversify'
import { BUS_REDIS_INTERNAL_SYMBOLS, BUS_REDIS_SYMBOLS } from './bus-redis-symbols'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import Redis from 'ioredis'
import { RedisTransportConfiguration } from './redis-transport-configuration'

import  { Job, Queue, Worker } from 'bullmq'
import * as uuid from 'uuid'

export const DEFAULT_MAX_RETRIES = 10

export type Connection = Redis.Redis

declare type Uuid = string;
interface Payload {
  message: string,
  correlationId: Uuid | undefined
  attributes: MessageAttributeMap
  stickyAttributes: MessageAttributeMap
}
export type RedisMessage = Job<Payload>

/**
 * A Redis transport adapter for @node-ts/bus.
 */
@injectable()
export class RedisMqTransport implements Transport<RedisMessage> {

  private connection: Connection
  private queue: Queue
  private worker: Worker
  private maxRetries: number
  private storeCompletedMessages: boolean
  
  constructor (
    @inject(BUS_REDIS_INTERNAL_SYMBOLS.RedisFactory)
      private readonly connectionFactory: () => Promise<Connection>,
    @inject(BUS_REDIS_SYMBOLS.TransportConfiguration)
      private readonly configuration: RedisTransportConfiguration,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.MessageSerializer)
      private readonly messageSerializer: MessageSerializer
  ) {
    this.maxRetries = configuration.maxRetries ?? DEFAULT_MAX_RETRIES
    this.storeCompletedMessages = configuration.storeCompletedMessages ?? false
  }

  async initialize (): Promise<void> {
    this.logger.info('Initializing Redis transport')
    this.connection = await this.connectionFactory()
    this.queue = new Queue(this.configuration.queueName, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: this.maxRetries
      }
    })
    
    this.worker = new Worker(this.configuration.queueName)
    this.logger.info('Redis transport initialized')
  }

  async dispose (): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    this.connection.disconnect()
    this.logger.info('Redis transport disposed')
  }

  async publish<TEvent extends Event> (event: TEvent, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<TCommand extends Command> (command: TCommand, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail (message: TransportMessage<RedisMessage>): Promise<void> {
    // Override any configured retries
    message.raw.discard()
    // Move to failed - with no retries
    await message
      .raw
      .moveToFailed(new Error(`Message: ${message.id} failed immediately when placed on the bus, moving straight to the failed queue`), message.id!)
  }

  async readNextMessage (): Promise<TransportMessage<RedisMessage> | undefined> {
    // Guide on how to manually handle jobs: https://docs.bullmq.io/patterns/manually-fetching-jobs
    const token = uuid.v4()
    const job = (await this.worker.getNextJob(token)) as RedisMessage
    
    if (job === undefined || !job.data) {
      return undefined
    }

    this.logger.debug('Received message from Redis', {redisMessage: job.data})
    const { message, ...attributes}: Payload = job.data
    const domainMessage = this.messageSerializer.deserialize(message)

    return {
      id: token,
      domainMessage,
      raw: job,
      attributes
    }
  }

  async deleteMessage (message: TransportMessage<RedisMessage>): Promise<void> {
    if (await message.raw.isFailed()) {  
      /* No need to delete its already been moved to the failed queue automatically,
       * or via this.fail() */ 
      return
    }
    this.logger.debug(
      'Deleting message',
      {
        rawMessage: {
          ...message.raw,
          content: message.raw.data
        }
      }
    )
    await message.raw.moveToCompleted(undefined, message.id!)
    if (!this.storeCompletedMessages) {
      await message.raw.remove()
    }
  }

  async returnMessage (message: TransportMessage<RedisMessage>): Promise<void> {
    const failedJobMessage = `Failed job: ${message.id}. Attempt: ${message.raw.attemptsMade + 1}/${this.maxRetries}`
    this.logger.debug(failedJobMessage)
    /* Bullmq queues support automatic retry, we simply need to state that it needs to moveToFailed.
    It will check the amount of attempts promote it to the `wait` queue ready for reprocessing
    */
    await message.raw.moveToFailed(new Error(failedJobMessage), message.id!)
  }

  private async publishMessage (
    message: Message,
    messageOptions: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    const payload: Payload = {
      message: this.messageSerializer.serialize(message),
      correlationId: messageOptions.correlationId,
      attributes: messageOptions.attributes,
      stickyAttributes: messageOptions.stickyAttributes
    }
    this.logger.debug('Sending message to Redis', {payload})
    await this.queue.add(message.$name, payload)
  }
}
