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
   * How long a message claimed for the first time is held for this dispatcher. Each later claim holds it for this
   * times the number of times it's been claimed, up to `maxLeaseMs`, so a message the broker keeps rejecting is
   * retried less often without holding up the others.
   */
  leaseMs: number
  /**
   * The longest a claimed message is held, which is the longest a message the broker rejects waits between tries
   */
  maxLeaseMs: number
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
   * How long sending is paused after a send or a read of the store fails, before one due message is sent to see if
   * the broker and store are working again. It doubles after each probe that fails, up to `maxPauseMs`.
   */
  pauseMs: number
  /**
   * The longest sending is paused between probes
   */
  maxPauseMs: number
  /**
   * How often a probe that fails is logged while sending stays paused
   */
  errorLogIntervalMs: number
}

export const DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS: OutgoingMessageDispatcherOptions =
  Object.freeze({
    pollIntervalMs: 1_000,
    leaseMs: 30_000,
    maxLeaseMs: 5 * 60_000,
    claimLimit: 100,
    sendTimeoutMs: 10_000,
    pauseMs: 1_000,
    maxPauseMs: 60_000,
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
    | 'releaseOutgoingMessages'
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
  typeof persistence.deleteOutgoingMessages === 'function' &&
  typeof persistence.releaseOutgoingMessages === 'function'

type SendResult = { sent: true } | { sent: false; error: unknown }

/**
 * Sends the messages in a store once they're due. Each started bus runs one. It checks the store every
 * `pollIntervalMs`, and sooner when this process stores a message that's due before then.
 *
 * Messages are claimed with a lease, so several processes that share a store send each message once. A message is
 * only ever deleted once it's sent, so delivery is at least once and nothing is dropped.
 *
 * When one message fails to send, or times out, the next message sent tells a message the broker rejects, such as
 * one that's too large, from a broker that's down. If the next one is sent, only the failed message is held back: it
 * keeps its lease and is retried when the lease ends, and the rest carry on. If two messages fail in a row, or the
 * store can't be read, it's a circuit breaker and sending pauses: no more sends start, the claimed messages that
 * weren't tried are released, and nothing more is claimed. After `pauseMs`, doubling up to `maxPauseMs` while the
 * broker keeps failing, it claims and sends one due message as a probe, and resumes once one is sent. A broker that's
 * down or refusing credentials pauses scheduled sends until it's fixed.
 */
export class OutgoingMessageDispatcher {
  private isRunning = false
  private loop: Promise<void> | undefined
  private wakeTimer: NodeJS.Timeout | undefined
  private wakeAt = Infinity
  private wake: (() => void) | undefined
  private earliestScheduledAt = Infinity
  private isPaused = false
  private pausedAt = 0
  private pauseMs: number
  private lastErrorLoggedAt = -Infinity
  private errorsSinceLastLog = 0
  /**
   * The message that failed last, until another is sent. A different message failing next pauses sending.
   */
  private lastFailedMessageId: string | undefined
  /**
   * Sends that timed out but haven't finished, which `stop()` waits a while for
   */
  private readonly abandonedSends = new Set<Promise<unknown>>()

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
  ) {
    this.pauseMs = options.pauseMs
  }

  /**
   * Whether sending is paused because a send or a read of the store failed
   */
  get paused(): boolean {
    return this.isPaused
  }

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
   * Stops checking the store, and waits for every send that's started to finish. A send that already timed out is
   * waited for for up to another `sendTimeoutMs`.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }
    this.isRunning = false
    this.wake?.()
    await this.loop
    this.loop = undefined
    await this.waitForAbandonedSends()
  }

  /**
   * Tells the dispatcher this process stored a message, so that it's sent when it's due rather than on the next
   * check of the store. Does nothing while sending is paused.
   * @param dueAt when the stored message is due
   */
  scheduled(dueAt: Date): void {
    if (!this.isRunning || this.isPaused) {
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
   * Sends the messages that are due, a batch at a time, until none are left, sending pauses or the dispatcher is
   * stopped. While sending is paused, it sends one due message as a probe instead, and carries on if that's sent.
   * It never throws, and returns once every send it started has finished.
   */
  async dispatchDueMessages(): Promise<void> {
    if (this.isPaused) {
      await this.probe()
    }
    // Runs at least once, so it can be called without starting the dispatcher
    while (!this.isPaused) {
      const claimedAt = Date.now()
      const claimed = await this.claim(this.options.claimLimit)
      if (!claimed || claimed.length === 0) {
        return
      }
      await this.sendBatch(claimed, claimedAt)
      if (claimed.length < this.options.claimLimit || !this.isRunning) {
        return
      }
    }
  }

  /**
   * Claims and sends one due message to see whether sending works again, and resumes if it's sent. If it fails, one
   * other message is tried straight away, since the first may be one the broker always rejects.
   */
  private async probe(): Promise<void> {
    for (let probes = 0; probes < 2; probes++) {
      const claimed = await this.claim(1)
      if (!claimed) {
        this.pauseLonger()
        return
      }
      if (claimed.length === 0) {
        // Nothing is claimable to probe with, which says nothing about the broker
        return
      }
      const [outgoingMessage] = claimed
      const result = await this.send(outgoingMessage)
      if (result.sent) {
        this.resume()
        return
      }
      this.logWhilePaused('Sending a scheduled message failed again', {
        messageId: outgoingMessage.id,
        error: serializeError(result.error)
      })
    }
    this.pauseLonger()
  }

  /**
   * Sends claimed messages, a few at a time, until they're all sent or sending pauses
   */
  private async sendBatch(
    claimed: OutgoingMessage[],
    claimedAt: number
  ): Promise<void> {
    const { leaseMs, sendTimeoutMs } = this.options
    const sendBefore = claimedAt + leaseMs - sendTimeoutMs
    const throttle = throat(SEND_CONCURRENCY)
    const notTried: string[] = []
    // Every send handles its own failure, so this waits for all of them, even when sending pauses part way
    await Promise.all(
      claimed.map(async outgoingMessage =>
        throttle(async () => {
          if (this.isPaused || Date.now() > sendBefore) {
            notTried.push(outgoingMessage.id)
            return
          }
          const result = await this.send(outgoingMessage)
          if (result.sent) {
            this.lastFailedMessageId = undefined
          } else {
            this.failed(result.error, outgoingMessage)
          }
        })
      )
    )
    await this.release(notTried)
  }

  /**
   * Handles a message that failed to send. A failure only holds that message back, and the next message sent shows
   * whether it was only that message. A different message failing before another is sent pauses sending, while the
   * same message failing again, such as one the broker always rejects, doesn't.
   */
  private failed(error: unknown, outgoingMessage: OutgoingMessage): void {
    const isAnotherFailure =
      this.lastFailedMessageId !== undefined &&
      this.lastFailedMessageId !== outgoingMessage.id
    if (this.isPaused || isAnotherFailure) {
      this.pause(error, outgoingMessage)
      return
    }
    this.lastFailedMessageId = outgoingMessage.id
    this.logger.warn(
      'Failed to send a scheduled message. It will be retried when its lease ends, and the next message sent shows whether only this one is rejected.',
      {
        messageId: outgoingMessage.id,
        attempts: outgoingMessage.attempts,
        error: serializeError(error)
      }
    )
  }

  /**
   * Makes claimed messages that weren't tried claimable again straight away. It never throws.
   */
  private async release(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    try {
      await this.store.releaseOutgoingMessages(ids)
    } catch (error) {
      this.logger.debug(
        'Failed to release scheduled messages that were not tried. They will be claimable when their lease ends.',
        { numMessages: ids.length, error: serializeError(error) }
      )
    }
  }

  /**
   * Sends one message and deletes it once it's sent. It never throws.
   */
  private async send(outgoingMessage: OutgoingMessage): Promise<SendResult> {
    const result = await this.sendWithTimeout(outgoingMessage)
    if (!result.sent) {
      return result
    }
    try {
      await this.store.deleteOutgoingMessages([outgoingMessage.id])
    } catch (error) {
      this.logger.error(
        'Failed to delete a scheduled message that was sent. It will be sent again when its lease ends.',
        { messageId: outgoingMessage.id, error: serializeError(error) }
      )
    }
    return result
  }

  private async sendWithTimeout(
    outgoingMessage: OutgoingMessage
  ): Promise<SendResult> {
    const { sendTimeoutMs } = this.options
    let timeout: NodeJS.Timeout | undefined
    let didTimeOut = false
    const timedOut = new Promise<SendResult>(resolve => {
      timeout = setTimeout(() => {
        didTimeOut = true
        resolve({
          sent: false,
          // Only logged, so it doesn't need an error class
          error: {
            message: `Sending the message took longer than ${sendTimeoutMs}ms`
          }
        })
      }, sendTimeoutMs)
    })
    const sent = this.sendMessage(outgoingMessage).then(
      (): SendResult => ({ sent: true }),
      (error: unknown): SendResult => ({ sent: false, error })
    )
    try {
      const result = await Promise.race([sent, timedOut])
      if (didTimeOut) {
        this.trackAbandonedSend(sent)
      }
      return result
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Keeps a send that timed out until it finishes, so `stop()` can wait for it
   */
  private trackAbandonedSend(sent: Promise<SendResult>): void {
    const tracked = sent.finally(() => this.abandonedSends.delete(tracked))
    this.abandonedSends.add(tracked)
  }

  /**
   * Waits up to `sendTimeoutMs` for sends that timed out to finish, so the transport isn't closed under them
   */
  private async waitForAbandonedSends(): Promise<void> {
    if (this.abandonedSends.size === 0) {
      return
    }
    let timeout: NodeJS.Timeout | undefined
    await Promise.race([
      Promise.all(this.abandonedSends),
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, this.options.sendTimeoutMs)
      })
    ])
    clearTimeout(timeout)
  }

  /**
   * Claims due messages, pausing sending if the store can't be read
   * @returns the claimed messages, or `undefined` if the store failed
   */
  private async claim(limit: number): Promise<OutgoingMessage[] | undefined> {
    try {
      return await this.store.claimDueOutgoingMessages(
        limit,
        this.options.leaseMs,
        this.options.maxLeaseMs
      )
    } catch (error) {
      if (this.isPaused) {
        this.logWhilePaused('Failed to claim scheduled messages again', {
          error: serializeError(error)
        })
      } else {
        this.pause(error)
      }
      return undefined
    }
  }

  /**
   * Pauses sending after a failure. Only the first failure is logged; failures while it's paused are throttled.
   */
  private pause(error: unknown, outgoingMessage?: OutgoingMessage): void {
    if (this.isPaused) {
      this.logWhilePaused('Sending a scheduled message failed while paused', {
        messageId: outgoingMessage?.id,
        error: serializeError(error)
      })
      return
    }
    this.isPaused = true
    this.pausedAt = Date.now()
    this.pauseMs = this.options.pauseMs
    // Probe failures are throttled from here, so the warning below isn't followed straight away by another log
    this.lastErrorLoggedAt = Date.now()
    this.errorsSinceLastLog = 0
    this.logger.warn(
      outgoingMessage
        ? 'Paused sending scheduled messages, because one failed to send. Nothing is dropped: sending resumes once a probe succeeds, and this message is retried when its lease ends.'
        : 'Paused sending scheduled messages, because the store of scheduled messages could not be read. Nothing is dropped: sending resumes once a probe succeeds.',
      {
        messageId: outgoingMessage?.id,
        attempts: outgoingMessage?.attempts,
        probeInMs: this.pauseMs,
        error: serializeError(error)
      }
    )
  }

  private pauseLonger(): void {
    this.pauseMs = Math.min(this.pauseMs * 2, this.options.maxPauseMs)
  }

  private resume(): void {
    this.isPaused = false
    this.lastFailedMessageId = undefined
    this.logger.info('Resumed sending scheduled messages', {
      pausedForMs: Date.now() - this.pausedAt,
      failuresSinceLastLog: this.errorsSinceLastLog
    })
    this.pauseMs = this.options.pauseMs
    this.errorsSinceLastLog = 0
  }

  /**
   * Logs a failure while sending is paused, at most once per `errorLogIntervalMs`
   */
  private logWhilePaused(message: string, context: object): void {
    this.errorsSinceLastLog++
    const now = Date.now()
    if (now - this.lastErrorLoggedAt < this.options.errorLogIntervalMs) {
      return
    }
    this.logger.warn(`${message}, so sending scheduled messages stays paused`, {
      ...context,
      failuresSinceLastLog: this.errorsSinceLastLog,
      probeInMs: this.pauseMs
    })
    this.lastErrorLoggedAt = now
    this.errorsSinceLastLog = 0
  }

  private async run(): Promise<void> {
    while (this.isRunning) {
      await this.dispatchDueMessages()
      if (!this.isRunning) {
        return
      }
      await this.waitForNextCheck()
    }
  }

  /**
   * Waits until the next poll, or until the earliest message this process stored since the last wait is due. While
   * sending is paused, waits until the next probe instead.
   */
  private async waitForNextCheck(): Promise<void> {
    const nextCheckAt = this.isPaused
      ? Date.now() + this.pauseMs
      : Math.min(
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
