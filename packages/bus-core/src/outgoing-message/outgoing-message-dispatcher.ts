import { serializeError } from 'serialize-error'
import throat from 'throat'
import { Logger } from '../logger'
import type { Persistence } from '../workflow/persistence'
import { OutgoingMessage } from './outgoing-message'

/**
 * How the dispatcher paces itself. Every bus uses the defaults; tests shorten them.
 */
export interface OutgoingMessageDispatcherOptions {
  /**
   * How often the store is checked for messages that are due
   */
  pollIntervalMs: number
  /**
   * How long a message claimed for the first time is held for this dispatcher. A message that's claimed again is
   * held for this times its attempts, so one that keeps failing is tried less often.
   */
  leaseMs: number
  /**
   * The most messages claimed at a time
   */
  claimLimit: number
  /**
   * How long one send may take before it counts as failed. A claimed message is only sent while at least this long
   * is left on its lease, so a slow or hung send can't outlive the lease and be sent by another process too.
   */
  sendTimeoutMs: number
  /**
   * How many times a message is claimed and fails to send before it's deleted, with an error logged
   */
  maxAttempts: number
  /**
   * How often a failure to read the store, such as the database being down, is logged while it keeps failing
   */
  errorLogIntervalMs: number
}

export const DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS: OutgoingMessageDispatcherOptions =
  Object.freeze({
    pollIntervalMs: 1_000,
    leaseMs: 30_000,
    claimLimit: 100,
    sendTimeoutMs: 10_000,
    maxAttempts: 10,
    errorLogIntervalMs: 60_000
  })

/**
 * How many claimed messages are sent at once
 */
const SEND_CONCURRENCY = 10

/**
 * A persistence that stores messages to send later
 */
export type OutgoingMessageStore = Required<
  Pick<
    Persistence,
    | 'storeOutgoingMessages'
    | 'claimDueOutgoingMessages'
    | 'deleteOutgoingMessages'
  >
>

/**
 * Sends one stored message on the transport
 */
export type OutgoingMessageSender = (
  outgoingMessage: OutgoingMessage
) => Promise<void>

/**
 * Whether a persistence can store messages to send later
 */
export const isOutgoingMessageStore = (
  persistence: Persistence
): persistence is Persistence & OutgoingMessageStore =>
  typeof persistence.storeOutgoingMessages === 'function' &&
  typeof persistence.claimDueOutgoingMessages === 'function' &&
  typeof persistence.deleteOutgoingMessages === 'function'

enum SendResult {
  Sent = 'sent',
  Failed = 'failed',
  TimedOut = 'timed-out'
}

/**
 * Sends the messages in a store once they're due. Each started bus runs one. It checks the store every
 * `pollIntervalMs`, and sooner when this process stores a message that's due before then.
 *
 * Messages are claimed with a lease, so several processes that share a store send each message once. Each message
 * is deleted as soon as it's sent. If its send fails or times out, or the process stops first, it's sent again
 * when its lease ends, so delivery is at least once. After `maxAttempts` failed attempts it's deleted and logged as
 * an error, with the whole message so it can be recovered.
 */
export class OutgoingMessageDispatcher {
  private isRunning = false
  private loop: Promise<void> | undefined
  private wakeTimer: NodeJS.Timeout | undefined
  private wakeAt = Infinity
  private wake: (() => void) | undefined
  private earliestScheduledAt = Infinity
  private lastErrorLoggedAt = -Infinity
  private errorsSinceLastLog = 0

  /**
   * @param store where the messages are stored
   * @param sendMessage sends one stored message on the transport
   * @param logger the logger of the bus that runs the dispatcher
   * @param options how the dispatcher paces itself
   */
  constructor(
    private readonly store: OutgoingMessageStore,
    private readonly sendMessage: OutgoingMessageSender,
    private readonly logger: Logger,
    private readonly options: OutgoingMessageDispatcherOptions = DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS
  ) {}

  /**
   * Starts checking the store for due messages. Does nothing if it's already running.
   */
  start(): void {
    if (this.isRunning) {
      return
    }
    this.isRunning = true
    this.loop = this.run()
  }

  /**
   * Stops checking the store, and waits for the messages being sent to finish
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }
    this.isRunning = false
    this.wake?.()
    await this.loop
    this.loop = undefined
  }

  /**
   * Tells the dispatcher this process stored a message, so that it's sent when it's due rather than on the next
   * check of the store
   * @param dueAt when the stored message is due
   */
  scheduled(dueAt: Date): void {
    if (!this.isRunning) {
      return
    }
    const dueAtMs = dueAt.getTime()
    if (this.wake) {
      if (dueAtMs < this.wakeAt) {
        this.setWakeTimer(dueAtMs)
      }
    } else {
      // The dispatcher is sending, so it waits for this once it's done
      this.earliestScheduledAt = Math.min(this.earliestScheduledAt, dueAtMs)
    }
  }

  /**
   * Claims and sends the messages that are due, a batch at a time, until none are left or the dispatcher is stopped
   * @throws the error of the store when it fails to claim or delete messages
   */
  async dispatchDueMessages(): Promise<void> {
    const { claimLimit, leaseMs, sendTimeoutMs } = this.options
    const throttle = throat(SEND_CONCURRENCY)
    // Runs at least once, so it can be called without starting the dispatcher
    while (true) {
      // Taken before claiming, so it's never later than the lease the store starts
      const claimedAt = Date.now()
      const claimed = await this.store.claimDueOutgoingMessages(
        claimLimit,
        leaseMs
      )
      if (claimed.length === 0) {
        return
      }
      this.logger.debug('Sending due outgoing messages', {
        numMessages: claimed.length
      })

      const sendBefore = claimedAt + leaseMs - sendTimeoutMs
      await Promise.all(
        claimed.map(async outgoingMessage =>
          throttle(async () => {
            if (Date.now() > sendBefore) {
              // Too little of the lease is left to send it safely. It's claimed again once the lease ends.
              return
            }
            await this.sendAndDelete(outgoingMessage)
          })
        )
      )

      if (claimed.length < claimLimit || !this.isRunning) {
        return
      }
    }
  }

  /**
   * Sends a claimed message and deletes it once it's sent, or deletes it if it has failed too many times
   */
  private async sendAndDelete(outgoingMessage: OutgoingMessage): Promise<void> {
    const { maxAttempts, sendTimeoutMs } = this.options
    const attempts = outgoingMessage.attempts ?? 1
    const result = await this.sendWithTimeout(outgoingMessage)
    if (result === SendResult.Sent) {
      await this.store.deleteOutgoingMessages([outgoingMessage.id])
      return
    }

    if (attempts >= maxAttempts) {
      this.logger.error(
        'Gave up sending a scheduled outgoing message after too many attempts, and deleted it. It can be sent again from this log.',
        {
          messageId: outgoingMessage.id,
          attempts,
          outgoingMessage
        }
      )
      await this.store.deleteOutgoingMessages([outgoingMessage.id])
      return
    }

    this.logger.warn(
      result === SendResult.TimedOut
        ? 'Sending a scheduled outgoing message timed out. It will be sent again when its lease ends.'
        : 'Failed to send a scheduled outgoing message. It will be sent again when its lease ends.',
      {
        messageId: outgoingMessage.id,
        attempts,
        sendTimeoutMs,
        retryAfterMs: this.options.leaseMs * attempts
      }
    )
  }

  private async sendWithTimeout(
    outgoingMessage: OutgoingMessage
  ): Promise<SendResult> {
    let timeout: NodeJS.Timeout | undefined
    const timedOut = new Promise<SendResult>(resolve => {
      timeout = setTimeout(
        () => resolve(SendResult.TimedOut),
        this.options.sendTimeoutMs
      )
    })
    const sent = this.sendMessage(outgoingMessage).then(
      () => SendResult.Sent,
      (error: unknown) => {
        this.logger.debug('Scheduled outgoing message failed to send', {
          messageId: outgoingMessage.id,
          error: serializeError(error)
        })
        return SendResult.Failed
      }
    )
    try {
      return await Promise.race([sent, timedOut])
    } finally {
      clearTimeout(timeout)
    }
  }

  private async run(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.dispatchDueMessages()
      } catch (error) {
        this.logDispatchError(error)
      }
      if (!this.isRunning) {
        return
      }
      await this.waitForNextCheck()
    }
  }

  /**
   * Logs a failure to read or update the store, at most once per `errorLogIntervalMs` while it keeps failing
   */
  private logDispatchError(error: unknown): void {
    this.errorsSinceLastLog++
    const now = Date.now()
    if (now - this.lastErrorLoggedAt < this.options.errorLogIntervalMs) {
      return
    }
    this.logger.error('Failed to dispatch due outgoing messages', {
      error: serializeError(error),
      failuresSinceLastLog: this.errorsSinceLastLog
    })
    this.lastErrorLoggedAt = now
    this.errorsSinceLastLog = 0
  }

  /**
   * Waits until the next poll, or until the earliest message this process stored since the last wait is due
   */
  private async waitForNextCheck(): Promise<void> {
    const nextCheckAt = Math.min(
      Date.now() + this.options.pollIntervalMs,
      this.earliestScheduledAt
    )
    this.earliestScheduledAt = Infinity
    await new Promise<void>(resolve => {
      this.wake = () => {
        clearTimeout(this.wakeTimer)
        this.wakeTimer = undefined
        this.wake = undefined
        this.wakeAt = Infinity
        resolve()
      }
      this.setWakeTimer(nextCheckAt)
    })
  }

  private setWakeTimer(wakeAt: number): void {
    clearTimeout(this.wakeTimer)
    this.wakeAt = wakeAt
    // A timer can fire a millisecond before the clock reaches its time, which would leave the message for the next poll
    this.wakeTimer = setTimeout(
      () => this.wake?.(),
      Math.max(0, wakeAt - Date.now() + 1)
    )
  }
}
