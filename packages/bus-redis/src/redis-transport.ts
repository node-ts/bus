import { Event, Command, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { Transport, TransportMessage, MessageSerializer, getLogger } from '@node-ts/bus-core'
import Redis from 'ioredis'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import { Job, Queue, Worker } from 'bullmq'
import * as uuid from 'uuid'

const logger = () => getLogger('@node-ts/bus-redis:redis-transport')

export const DEFAULT_MAX_RETRIES = 10
export type Connection = Redis.Redis

declare type Uuid = string

interface Payload {
  message: string,
  correlationId: Uuid | undefined
  attributes: MessageAttributeMap
  stickyAttributes: MessageAttributeMap
}

export interface RedisMessage {
  /**
   * A BullMQ Job is the message on the queue.
   * a Job stores its attempts and other metadata and
   * has the `data` key that stores the payload to send.
   * The shape of this payload is the @see Payload
   * Jobs automatically serialize/deserialize using JSON.stringify()
   */
  job: Job<Payload>,

  /**
   * The uuid for locking this Job to the particular worker that is processing it
   * This is required for all queue operations on this job - and is used to avoid
   * race conditions. e.g. two workers trying to pull the same message off the queue
   * at the same time.
   */
  token: string
}

export class RedisTransport implements Transport<RedisMessage> {

  private connection: Connection
  private queue: Queue
  private worker: Worker
  private maxRetries: number

  /**
   * A Redis transport adapter for @node-ts/bus.
   * @param configuration Settings used when connecting to redis and controlling this transports behavior
   * @param connectionFactory A callback that creates a new connection to Redis
   */
  constructor (
    private readonly configuration: RedisTransportConfiguration,
    private readonly connectionFactory: () => Connection = () => new Redis(configuration.connectionString)
  ) {
    this.maxRetries = configuration.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  async initialize (): Promise<void> {
    logger().info('Initializing Redis transport')
    this.connection = this.connectionFactory()
    this.queue = new Queue(this.configuration.queueName, {
      connection: this.connection
    })

    this.worker = new Worker(this.queue.name)
    logger().info('Redis transport initialized')
  }

  async dispose (): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    this.connection.disconnect()
    logger().info('Redis transport disposed')
  }

  async publish<TEvent extends Event> (event: TEvent, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<TCommand extends Command> (command: TCommand, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail (message: TransportMessage<RedisMessage>): Promise<void> {
    // Override any configured retries
    message.raw.job.discard()
    // Move to failed - with no retries
    await message
      .raw
      .job
      .moveToFailed(
        new Error(
          `Message: ${message.id} failed immediately when placed on the bus,`
            + ` moving straight to the failed queue`
        ), message.raw.token
      )
  }

  async readNextMessage (): Promise<TransportMessage<RedisMessage> | undefined> {
    // Guide on how to manually handle jobs: https://docs.bullmq.io/patterns/manually-fetching-jobs

    /*
      token is not a unique identifier for the message, but a way of identifying that this worker
      has a lock on this job
    */
    const token = uuid.v4()
    const job = (await this.worker.getNextJob(token)) as Job<Payload> | undefined

    if (!job || !job.data) {
      return undefined
    }

    logger().debug('Received message from Redis', {redisMessage: job.data})
    const { message, ...attributes}: Payload = job.data
    const domainMessage = MessageSerializer.deserialize(message)

    return {
      id: job.id,
      domainMessage,
      raw: {job, token},
      attributes
    }
  }

  async deleteMessage (message: TransportMessage<RedisMessage>): Promise<void> {
    if (await message.raw.job.isFailed()) {
      /* No need to delete its already been moved to the failed queue automatically,
       * or via this.fail() */
      return
    }
    logger().debug(
      'Deleting message',
      {
        rawMessage: {
          ...message.raw,
          content: message.raw.job.data
        }
      }
    )
    await message.raw.job.moveToCompleted(undefined, message.raw.token)
  }

  async returnMessage (message: TransportMessage<RedisMessage>): Promise<void> {
    const failedJobMessage =
      `Failed job: ${message.id}. Attempt: ${message.raw.job.attemptsMade + 1}/${this.maxRetries}`
    logger().debug(failedJobMessage)
    /*
      BullMQ queues support automatic retry, we simply need to state that it needs to moveToFailed.
      It will check the amount of attempts promote it to the `wait` queue ready for reprocessing
    */
    await message.raw.job.moveToFailed(new Error(failedJobMessage), message.raw.token)
  }

  private async publishMessage (
    message: Message,
    messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    const payload: Payload = {
      message: MessageSerializer.serialize(message),
      correlationId: messageOptions.correlationId,
      attributes: messageOptions.attributes,
      stickyAttributes: messageOptions.stickyAttributes
    }
    logger().debug('Sending message to Redis', {payload})
    await this.queue.add(message.$name, payload, {
      jobId: uuid.v4(),
      attempts: this.maxRetries,
      removeOnComplete: true
    })
  }
}
