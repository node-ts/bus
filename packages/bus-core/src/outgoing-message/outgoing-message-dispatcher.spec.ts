import { IMock, It, Mock, Times } from 'typemoq'
import { Logger } from '../logger'
import { TestCommand } from '../test/test-command'
import { CoreDependencies, sleep } from '../util'
import { InMemoryPersistence, Persistence } from '../workflow/persistence'
import { OutgoingMessage } from './outgoing-message'
import {
  DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
  isOutgoingMessageStore,
  OutgoingMessageDispatcher,
  OutgoingMessageDispatcherOptions,
  OutgoingMessageStore
} from './outgoing-message-dispatcher'

interface Sender {
  send(outgoingMessage: OutgoingMessage): Promise<void>
}

const outgoingMessage = (id: string, dueAt = new Date()): OutgoingMessage => ({
  id,
  kind: 'send',
  message: { ...new TestCommand() },
  attributes: { messageId: id, attributes: {}, stickyAttributes: {} },
  headers: {},
  dueAt
})

const END_OF_TIME = new Date(8_640_000_000_000_000)

const never = new Promise<void>(() => undefined)

const until = async (condition: () => boolean, timeoutMs = 5_000) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for the condition')
    }
    await sleep(5)
  }
}

const preparedInMemoryPersistence = () => {
  const persistence = new InMemoryPersistence()
  persistence.prepare({
    loggerFactory: () => Mock.ofType<Logger>().object
  } as unknown as CoreDependencies)
  return persistence
}

describe('OutgoingMessageDispatcher', () => {
  let sut: OutgoingMessageDispatcher
  let store: IMock<OutgoingMessageStore>
  let sender: IMock<Sender>
  let logger: IMock<Logger>
  let claimLimits: number[]

  const createSut = (
    options: Partial<OutgoingMessageDispatcherOptions> = {}
  ) => {
    store = Mock.ofType<OutgoingMessageStore>()
    sender = Mock.ofType<Sender>()
    logger = Mock.ofType<Logger>()
    sut = new OutgoingMessageDispatcher(
      store.object,
      async message => sender.object.send(message),
      logger.object,
      { ...DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS, ...options }
    )
  }

  /**
   * Has the store return each batch in turn from successive claims, and nothing after that
   */
  const claims = (...batches: OutgoingMessage[][]) => {
    let claim = 0
    claimLimits = []
    store
      .setup(async s =>
        s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
      )
      .returns(async limit => {
        claimLimits.push(limit)
        return batches[claim++] ?? []
      })
  }

  const wasSent = (message: OutgoingMessage) => {
    try {
      sender.verify(async s => s.send(message), Times.once())
      return true
    } catch {
      return false
    }
  }

  describe('when due messages are claimed', () => {
    const first = outgoingMessage('first')
    const second = outgoingMessage('second')

    beforeAll(async () => {
      createSut()
      claims([first, second])
      await sut.dispatchDueMessages()
    })

    it('should claim them with a lease', () => {
      const { claimLimit, leaseMs, maxLeaseMs } =
        DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS
      store.verify(
        async s => s.claimDueOutgoingMessages(claimLimit, leaseMs, maxLeaseMs),
        Times.once()
      )
    })

    it('should send each of them', () => {
      sender.verify(async s => s.send(first), Times.once())
      sender.verify(async s => s.send(second), Times.once())
    })

    it('should delete each one as soon as it is sent', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['first'])),
        Times.once()
      )
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['second'])),
        Times.once()
      )
    })
  })

  describe('when one message fails to send and the next is sent', () => {
    const rejected = outgoingMessage('rejected')
    const others = Array.from({ length: 14 }, (_, i) =>
      outgoingMessage(`other-${i}`)
    )

    beforeAll(async () => {
      createSut()
      claims([rejected, ...others])
      sender
        .setup(async s => s.send(rejected))
        .returns(async () => Promise.reject(new Error('message too large')))
      await sut.dispatchDueMessages()
    })

    it('should not pause sending', () => {
      expect(sut.paused).toEqual(false)
    })

    it('should send every other message', () => {
      others.forEach(message => expect(wasSent(message)).toEqual(true))
    })

    it('should keep the message that failed', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['rejected'])),
        Times.never()
      )
    })

    it('should warn about the message that failed', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.startsWith('Failed to send')),
            It.isObjectWith({ messageId: 'rejected' })
          ),
        Times.once()
      )
    })
  })

  describe('when two messages fail to send in a row', () => {
    const failing = [outgoingMessage('failing-1'), outgoingMessage('failing-2')]
    const others = Array.from({ length: 13 }, (_, i) =>
      outgoingMessage(`other-${i}`)
    )
    let sendCount = 0

    beforeAll(async () => {
      // Ten sends start at once. The failing ones fail first, so none of the others start after them.
      createSut()
      claims([...failing, ...others], [outgoingMessage('next-batch')])
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async message => {
          sendCount++
          if (message.id.startsWith('failing')) {
            throw new Error('broker is unreachable')
          }
          await sleep(50)
        })
      await sut.dispatchDueMessages()
    })

    it('should pause sending', () => {
      expect(sut.paused).toEqual(true)
    })

    it('should not start any more sends', () => {
      expect(sendCount).toEqual(10)
    })

    it('should release the messages it did not try', () => {
      store.verify(
        async s =>
          s.releaseOutgoingMessages(
            It.isValue(
              others.slice(8).map(message => ({ id: message.id, attempts: 1 }))
            )
          ),
        Times.once()
      )
    })

    it('should not claim any more messages', () => {
      expect(claimLimits).toHaveLength(1)
    })

    it('should not delete the messages that failed', () => {
      store.verify(
        async s =>
          s.deleteOutgoingMessages(
            It.is<string[]>(ids => ids[0].startsWith('failing'))
          ),
        Times.never()
      )
    })

    it('should warn once that it paused, with the error', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.startsWith('Paused')),
            It.is<{ error: { message: string } }>(
              context => context.error.message === 'broker is unreachable'
            )
          ),
        Times.once()
      )
    })
  })

  describe('when the same message fails again', () => {
    const rejected = outgoingMessage('rejected')

    beforeAll(async () => {
      createSut()
      claims([rejected], [rejected])
      sender
        .setup(async s => s.send(rejected))
        .returns(async () => Promise.reject(new Error('message too large')))
      await sut.dispatchDueMessages()
      await sut.dispatchDueMessages()
    })

    it('should not pause sending', () => {
      expect(sut.paused).toEqual(false)
    })
  })

  describe('when sends hang', () => {
    const hanging = [outgoingMessage('hanging-1'), outgoingMessage('hanging-2')]

    beforeAll(async () => {
      createSut({ sendTimeoutMs: 50 })
      claims(hanging)
      sender.setup(async s => s.send(It.isAny())).returns(async () => never)
      await sut.dispatchDueMessages()
    })

    it('should give up on them after the send timeout and pause sending', () => {
      expect(sut.paused).toEqual(true)
      store.verify(
        async s => s.deleteOutgoingMessages(It.isAny()),
        Times.never()
      )
    })
  })

  describe('when it is stopped after a send timed out', () => {
    const slow = outgoingMessage('slow')
    let stopTookMs: number

    beforeAll(async () => {
      createSut({ sendTimeoutMs: 100 })
      claims([slow])
      sender.setup(async s => s.send(slow)).returns(async () => sleep(150))
      sut.start()
      await until(() => {
        try {
          logger.verify(
            l =>
              l.warn(It.isAnyString(), It.isObjectWith({ messageId: 'slow' })),
            Times.once()
          )
          return true
        } catch {
          return false
        }
      })
      const stopping = Date.now()
      await sut.stop()
      stopTookMs = Date.now() - stopping
    })

    it('should wait for the send that timed out to finish', () => {
      expect(stopTookMs).toBeGreaterThanOrEqual(30)
      expect(stopTookMs).toBeLessThan(100)
    })
  })

  describe('when sending is paused and the probe succeeds', () => {
    const pauseMs = 50
    const failing = [outgoingMessage('failing-1'), outgoingMessage('failing-2')]
    const probe = outgoingMessage('probe')
    const resumed = [outgoingMessage('resumed-1'), outgoingMessage('resumed-2')]
    let failedAt: number
    let probedAt: number

    beforeAll(async () => {
      createSut({ pauseMs })
      claims(failing, [probe], resumed)
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async message => {
          if (message.id.startsWith('failing')) {
            failedAt = Date.now()
            throw new Error('broker is unreachable')
          }
          if (message.id === 'probe') {
            probedAt = Date.now()
          }
        })
      sut.start()
      await until(() => resumed.every(wasSent))
      await sut.stop()
    })

    it('should wait for the pause before probing', () => {
      expect(probedAt - failedAt).toBeGreaterThanOrEqual(pauseMs - 5)
    })

    it('should probe with a single message', () => {
      expect(claimLimits[1]).toEqual(1)
    })

    it('should resume sending, and log that it did', () => {
      expect(sut.paused).toEqual(false)
      logger.verify(
        l => l.info('Resumed sending scheduled messages', It.isAny()),
        Times.once()
      )
    })

    it('should send the next batch', () => {
      expect(claimLimits[2]).toEqual(
        DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS.claimLimit
      )
      resumed.forEach(message => expect(wasSent(message)).toEqual(true))
    })
  })

  describe('when sending is paused and the probe finds a message the broker rejects', () => {
    const failing = [outgoingMessage('failing-1'), outgoingMessage('failing-2')]
    const rejected = outgoingMessage('rejected')
    const good = outgoingMessage('good')

    beforeAll(async () => {
      createSut({ pauseMs: 20 })
      claims(failing, [rejected], [good])
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async message => {
          if (message.id !== 'good') {
            throw new Error('rejected')
          }
        })
      sut.start()
      await until(() => wasSent(good))
      await sut.stop()
    })

    it('should try another message straight away, and resume once that is sent', () => {
      expect(claimLimits.slice(1, 3)).toEqual([1, 1])
      expect(sut.paused).toEqual(false)
    })
  })

  describe('when sending is paused and there is nothing to probe with', () => {
    let claimTimes: number[]

    beforeAll(async () => {
      createSut({ pauseMs: 20, maxPauseMs: 1_000 })
      claimTimes = []
      let claim = 0
      store
        .setup(async s =>
          s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
        )
        .returns(async () => {
          claimTimes.push(Date.now())
          return claim++ === 0
            ? [outgoingMessage('failing-1'), outgoingMessage('failing-2')]
            : []
        })
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async () => Promise.reject(new Error('broker is down')))
      sut.start()
      await until(() => claimTimes.length >= 6)
      await sut.stop()
    })

    it('should not wait any longer between probes', () => {
      const gaps = claimTimes
        .slice(2)
        .map((time, i) => time - claimTimes[i + 1])
      expect(Math.max(...gaps)).toBeLessThan(60)
    })
  })

  describe('when probes keep failing', () => {
    let claimTimes: number[]

    beforeAll(async () => {
      createSut({
        pollIntervalMs: 10,
        pauseMs: 10,
        maxPauseMs: 40,
        errorLogIntervalMs: 60_000
      })
      claimTimes = []
      store
        .setup(async s =>
          s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
        )
        .returns(async () => {
          claimTimes.push(Date.now())
          return [outgoingMessage(`message-${claimTimes.length}`)]
        })
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async () => Promise.reject(new Error('bad credentials')))
      sut.start()
      await until(() => claimTimes.length >= 14)
      await sut.stop()
    })

    it('should wait longer between probes, up to the longest pause', () => {
      const gaps = claimTimes.slice(1).map((time, i) => time - claimTimes[i])
      expect(Math.max(...gaps)).toBeGreaterThanOrEqual(35)
      expect(Math.max(...gaps)).toBeLessThan(100)
    })

    it('should only warn about the first failure and the pause, not every failed probe', () => {
      logger.verify(l => l.warn(It.isAnyString(), It.isAny()), Times.exactly(2))
    })

    it('should stay paused without deleting anything', () => {
      expect(sut.paused).toEqual(true)
      store.verify(
        async s => s.deleteOutgoingMessages(It.isAny()),
        Times.never()
      )
    })
  })

  describe('when the store keeps failing', () => {
    let failures = 0

    beforeAll(async () => {
      createSut({ pauseMs: 5, maxPauseMs: 10, errorLogIntervalMs: 60_000 })
      store
        .setup(async s =>
          s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
        )
        .returns(async () => {
          failures++
          throw new Error('database is down')
        })
      sut.start()
      await until(() => failures >= 5)
      await sut.stop()
    })

    it('should pause sending', () => {
      expect(sut.paused).toEqual(true)
    })

    it('should warn once, then throttle its logs', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.startsWith('Paused')),
            It.is<{ error: { message: string } }>(
              context => context.error.message === 'database is down'
            )
          ),
        Times.once()
      )
      logger.verify(l => l.warn(It.isAnyString(), It.isAny()), Times.once())
    })
  })

  describe('when too little of the lease is left to send the rest of a batch', () => {
    const batch = Array.from({ length: 12 }, (_, i) =>
      outgoingMessage(`message-${i}`)
    )
    let sendCount = 0

    beforeAll(async () => {
      // Ten messages are sent at once, and each takes longer than the 100ms left to start sending
      createSut({ leaseMs: 300, sendTimeoutMs: 200 })
      claims(batch)
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async () => {
          sendCount++
          await sleep(150)
        })
      await sut.dispatchDueMessages()
    })

    it('should leave the rest to be claimed again', () => {
      expect(sendCount).toEqual(10)
    })

    it('should not pause sending', () => {
      expect(sut.paused).toEqual(false)
    })
  })

  describe('when it is started and a full batch is claimed', () => {
    const last = outgoingMessage('last')

    beforeAll(async () => {
      createSut({ claimLimit: 2 })
      claims([outgoingMessage('a'), outgoingMessage('b')], [last])
      sut.start()
      await until(() => wasSent(last))
      await sut.stop()
    })

    it('should claim the next batch straight away', () => {
      expect(wasSent(last)).toEqual(true)
    })
  })

  describe('when it is told a message was scheduled before the next poll', () => {
    let claimTimes: number[]
    let scheduledAt: number

    beforeAll(async () => {
      createSut()
      claimTimes = []
      store
        .setup(async s =>
          s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
        )
        .returns(async () => {
          claimTimes.push(Date.now())
          return []
        })
      sut.start()
      // Let the first check run, so the dispatcher waits for the next poll
      await sleep(50)
      scheduledAt = Date.now() + 200
      sut.scheduled(new Date(scheduledAt))
      await sleep(400)
      await sut.stop()
    })

    it('should check the store when the message is due', () => {
      expect(claimTimes.length).toBeGreaterThanOrEqual(2)
      expect(claimTimes[1]).toBeGreaterThanOrEqual(scheduledAt)
      expect(claimTimes[1]).toBeLessThan(scheduledAt + 150)
    })
  })

  describe('when it is stopped', () => {
    let claimsAfterStop: number

    beforeAll(async () => {
      createSut({ pollIntervalMs: 20 })
      let claimCount = 0
      store
        .setup(async s =>
          s.claimDueOutgoingMessages(It.isAny(), It.isAny(), It.isAny())
        )
        .returns(async () => {
          claimCount++
          return []
        })
      sut.start()
      await sleep(50)
      await sut.stop()
      const claimsAtStop = claimCount
      await sleep(100)
      claimsAfterStop = claimCount - claimsAtStop
    })

    it('should stop checking the store', () => {
      expect(claimsAfterStop).toEqual(0)
    })
  })

  describe('when it is stopped while sending is paused', () => {
    let stopTookMs: number

    beforeAll(async () => {
      createSut({ pauseMs: 10_000 })
      claims([outgoingMessage('failing-1'), outgoingMessage('failing-2')])
      sender
        .setup(async s => s.send(It.isAny()))
        .returns(async () => Promise.reject(new Error('broker is down')))
      sut.start()
      await until(() => sut.paused)
      const stopping = Date.now()
      await sut.stop()
      stopTookMs = Date.now() - stopping
    })

    it('should stop without waiting for the next probe', () => {
      expect(stopTookMs).toBeLessThan(200)
    })
  })

  describe('when it is stopped while a message is being sent and deleting another fails', () => {
    const slow = outgoingMessage('slow')
    const fast = outgoingMessage('fast')
    let stoppedBeforeSendFinished = false

    beforeAll(async () => {
      createSut()
      claims([slow, fast])
      let finishSend: () => void = () => undefined
      let fastDeleteFailed = false
      sender
        .setup(async s => s.send(slow))
        .returns(
          async () => new Promise<void>(resolve => (finishSend = resolve))
        )
      store
        .setup(async s => s.deleteOutgoingMessages(It.isValue(['fast'])))
        .returns(async () => {
          fastDeleteFailed = true
          throw new Error('database is down')
        })
      sut.start()
      await until(() => fastDeleteFailed)

      let stopped = false
      const stopping = sut.stop().then(() => (stopped = true))
      await sleep(50)
      stoppedBeforeSendFinished = stopped
      finishSend()
      await stopping
    })

    it('should wait for the send that is still in flight', () => {
      expect(stoppedBeforeSendFinished).toEqual(false)
    })

    it('should delete the message once that send finishes', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['slow'])),
        Times.once()
      )
    })

    it('should only log the failed delete', () => {
      logger.verify(
        l =>
          l.error(
            It.is<string>(message => message.includes('delete')),
            It.isObjectWith({ messageId: 'fast' })
          ),
        Times.once()
      )
      expect(sut.paused).toEqual(false)
    })
  })

  describe('when the broker always rejects one message among many', () => {
    const persistence = preparedInMemoryPersistence()
    const deliveredAt = new Map<string, number>()
    let laterDueAt: number
    let pausedAtAnyPoint = false

    beforeAll(async () => {
      const now = Date.now()
      laterDueAt = now + 250
      await persistence.storeOutgoingMessages([
        outgoingMessage('rejected', new Date(now - 1_000)),
        ...Array.from({ length: 50 }, (_, i) =>
          outgoingMessage(`now-${i}`, new Date(now))
        ),
        // Due after the rejected message's lease ends, when it's tried again
        ...Array.from({ length: 20 }, (_, i) =>
          outgoingMessage(`later-${i}`, new Date(laterDueAt))
        )
      ])
      sut = new OutgoingMessageDispatcher(
        persistence,
        async message => {
          pausedAtAnyPoint ||= sut.paused
          if (message.id === 'rejected') {
            throw new Error('message too large')
          }
          deliveredAt.set(message.id, Date.now())
        },
        Mock.ofType<Logger>().object,
        {
          ...DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
          pollIntervalMs: 20,
          claimLimit: 10,
          leaseMs: 200,
          maxLeaseMs: 400,
          sendTimeoutMs: 50
        }
      )
      sut.start()
      await until(() => deliveredAt.size === 70)
      await sut.stop()
    })

    it('should never pause sending', () => {
      expect(pausedAtAnyPoint).toEqual(false)
      expect(sut.paused).toEqual(false)
    })

    it('should send the other messages on time', () => {
      const lateness = [...deliveredAt.entries()]
        .filter(([id]) => id.startsWith('later'))
        .map(([, at]) => at - laterDueAt)
      expect(Math.max(...lateness)).toBeLessThan(150)
    })
  })

  describe('when the broker always rejects two messages and another is scheduled', () => {
    const persistence = preparedInMemoryPersistence()
    const pauseMs = 100
    let scheduledDueAt: number
    let sentAt: number | undefined

    beforeAll(async () => {
      const earlier = new Date(Date.now() - 1_000)
      await persistence.storeOutgoingMessages([
        outgoingMessage('rejected-1', earlier),
        outgoingMessage('rejected-2', earlier)
      ])
      let rejections = 0
      sut = new OutgoingMessageDispatcher(
        persistence,
        async message => {
          if (message.id.startsWith('rejected')) {
            rejections++
            throw new Error('message too large')
          }
          sentAt = Date.now()
        },
        Mock.ofType<Logger>().object,
        {
          ...DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
          pollIntervalMs: 20,
          pauseMs,
          maxPauseMs: 3_000,
          leaseMs: 100,
          maxLeaseMs: 200,
          sendTimeoutMs: 50
        }
      )
      sut.start()
      // Both have been retried a few times by now
      await until(() => rejections >= 8)
      scheduledDueAt = Date.now()
      await persistence.storeOutgoingMessages([
        outgoingMessage('scheduled', new Date(scheduledDueAt))
      ])
      sut.scheduled(new Date(scheduledDueAt))
      await until(() => sentAt !== undefined)
      await sut.stop()
    })

    it('should send the new message without waiting longer than the shortest pause', () => {
      expect(sentAt! - scheduledDueAt).toBeLessThan(pauseMs + 100)
    })
  })

  describe('when the broker always rejects one message', () => {
    const persistence = preparedInMemoryPersistence()
    const rejectedAttempts: number[] = []
    const delivered: string[] = []
    let stillStored: OutgoingMessage[]

    beforeAll(async () => {
      const earlier = new Date(Date.now() - 1_000)
      await persistence.storeOutgoingMessages([
        outgoingMessage('rejected', earlier),
        outgoingMessage('a'),
        outgoingMessage('b')
      ])
      sut = new OutgoingMessageDispatcher(
        persistence,
        async message => {
          if (message.id === 'rejected') {
            rejectedAttempts.push(Date.now())
            throw new Error('message too large')
          }
          delivered.push(message.id)
        },
        Mock.ofType<Logger>().object,
        {
          ...DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
          pollIntervalMs: 10,
          pauseMs: 10,
          leaseMs: 100,
          maxLeaseMs: 150,
          sendTimeoutMs: 50
        }
      )
      sut.start()
      await until(() => rejectedAttempts.length >= 3 && delivered.length === 2)
      await sut.stop()
      stillStored = await persistence.claimDueOutgoingMessages(
        10,
        1,
        1,
        END_OF_TIME
      )
    })

    it('should send the other messages', () => {
      expect(delivered.sort()).toEqual(['a', 'b'])
    })

    it('should keep retrying it, waiting longer each time up to the longest lease', () => {
      const gaps = rejectedAttempts
        .slice(1)
        .map((time, i) => time - rejectedAttempts[i])
      expect(gaps[0]).toBeGreaterThanOrEqual(95)
      expect(gaps[1]).toBeGreaterThanOrEqual(145)
    })

    it('should never delete it', () => {
      expect(stillStored.map(m => m.id)).toEqual(['rejected'])
    })
  })
})

describe('isOutgoingMessageStore', () => {
  describe('when given InMemoryPersistence', () => {
    it('should be true', () => {
      expect(isOutgoingMessageStore(new InMemoryPersistence())).toEqual(true)
    })
  })

  describe('when given a persistence without the outgoing message methods', () => {
    it('should be false', () => {
      expect(isOutgoingMessageStore({} as Persistence)).toEqual(false)
    })
  })
})
