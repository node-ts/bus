import { IMock, It, Mock, Times } from 'typemoq'
import { Logger } from '../logger'
import { TestCommand } from '../test/test-command'
import { sleep } from '../util'
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

const outgoingMessage = (id: string, attempts = 1): OutgoingMessage => ({
  id,
  kind: 'send',
  message: { ...new TestCommand() },
  attributes: { messageId: id, attributes: {}, stickyAttributes: {} },
  headers: {},
  dueAt: new Date(),
  attempts
})

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

describe('OutgoingMessageDispatcher', () => {
  let sut: OutgoingMessageDispatcher
  let store: IMock<OutgoingMessageStore>
  let sender: IMock<Sender>
  let logger: IMock<Logger>

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

  const claims = (...batches: OutgoingMessage[][]) => {
    let claim = 0
    store
      .setup(async s => s.claimDueOutgoingMessages(It.isAny(), It.isAny()))
      .returns(async () => batches[claim++] ?? [])
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
      store.verify(
        async s =>
          s.claimDueOutgoingMessages(
            DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS.claimLimit,
            DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS.leaseMs
          ),
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

  describe('when sending a claimed message fails', () => {
    const failing = outgoingMessage('failing')
    const sent = outgoingMessage('sent')

    beforeAll(async () => {
      createSut()
      claims([failing, sent])
      sender
        .setup(async s => s.send(failing))
        .returns(async () => Promise.reject(new Error('transport is down')))
      await sut.dispatchDueMessages()
    })

    it('should only delete the messages that were sent', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['sent'])),
        Times.once()
      )
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['failing'])),
        Times.never()
      )
    })

    it('should warn that it will be sent again', () => {
      logger.verify(
        l =>
          l.warn(It.isAnyString(), It.isObjectWith({ messageId: 'failing' })),
        Times.once()
      )
    })
  })

  describe('when a send hangs', () => {
    const hanging = outgoingMessage('hanging')
    const sent = outgoingMessage('sent')

    beforeAll(async () => {
      createSut({ sendTimeoutMs: 50 })
      claims([hanging, sent])
      sender.setup(async s => s.send(hanging)).returns(async () => never)
      await sut.dispatchDueMessages()
    })

    it('should give up on it after the send timeout, and leave it to be claimed again', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['hanging'])),
        Times.never()
      )
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.includes('timed out')),
            It.isObjectWith({ messageId: 'hanging' })
          ),
        Times.once()
      )
    })

    it('should still delete the messages that were sent', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['sent'])),
        Times.once()
      )
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
  })

  describe('when a message fails on its last attempt', () => {
    const exhausted = outgoingMessage('exhausted', 3)

    beforeAll(async () => {
      createSut({ maxAttempts: 3 })
      claims([exhausted])
      sender
        .setup(async s => s.send(exhausted))
        .returns(async () => Promise.reject(new Error('rejected by broker')))
      await sut.dispatchDueMessages()
    })

    it('should delete it', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['exhausted'])),
        Times.once()
      )
    })

    it('should log an error with the message, so it can be recovered', () => {
      logger.verify(
        l =>
          l.error(
            It.isAnyString(),
            It.isObjectWith({
              messageId: 'exhausted',
              attempts: 3,
              outgoingMessage: exhausted
            })
          ),
        Times.once()
      )
    })
  })

  describe('when no messages are due', () => {
    beforeAll(async () => {
      createSut()
      claims([])
      await sut.dispatchDueMessages()
    })

    it('should not delete anything', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isAny()),
        Times.never()
      )
    })
  })

  describe('when it is started and a full batch is claimed', () => {
    const last = outgoingMessage('last')

    beforeAll(async () => {
      createSut({ claimLimit: 2 })
      claims([outgoingMessage('a'), outgoingMessage('b')], [last])
      sut.start()
      await until(() => {
        try {
          sender.verify(async s => s.send(last), Times.once())
          return true
        } catch {
          return false
        }
      })
      await sut.stop()
    })

    it('should claim the next batch straight away', () => {
      sender.verify(async s => s.send(last), Times.once())
    })
  })

  describe('when it is told a message was scheduled before the next poll', () => {
    let claimTimes: number[]
    let scheduledAt: number

    beforeAll(async () => {
      createSut()
      claimTimes = []
      store
        .setup(async s => s.claimDueOutgoingMessages(It.isAny(), It.isAny()))
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
        .setup(async s => s.claimDueOutgoingMessages(It.isAny(), It.isAny()))
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

  describe('when it is stopped while a message is being sent', () => {
    const inFlight = outgoingMessage('in-flight')
    let stoppedBeforeSendFinished = false

    beforeAll(async () => {
      createSut()
      claims([inFlight])
      let finishSend: () => void = () => undefined
      let sendStarted = false
      sender
        .setup(async s => s.send(inFlight))
        .returns(async () => {
          sendStarted = true
          await new Promise<void>(resolve => (finishSend = resolve))
        })
      sut.start()
      await until(() => sendStarted)

      let stopped = false
      const stopping = sut.stop().then(() => (stopped = true))
      await sleep(50)
      stoppedBeforeSendFinished = stopped
      finishSend()
      await stopping
    })

    it('should wait for the send to finish', () => {
      expect(stoppedBeforeSendFinished).toEqual(false)
    })

    it('should delete the message it sent', () => {
      store.verify(
        async s => s.deleteOutgoingMessages(It.isValue(['in-flight'])),
        Times.once()
      )
    })
  })

  describe('when the store keeps failing', () => {
    let failures = 0

    beforeAll(async () => {
      createSut({ pollIntervalMs: 10, errorLogIntervalMs: 60_000 })
      store
        .setup(async s => s.claimDueOutgoingMessages(It.isAny(), It.isAny()))
        .returns(async () => {
          failures++
          throw new Error('database is down')
        })
      sut.start()
      await until(() => failures >= 5)
      await sut.stop()
    })

    it('should log the failure once per interval', () => {
      logger.verify(
        l => l.error('Failed to dispatch due outgoing messages', It.isAny()),
        Times.once()
      )
    })
  })

  describe('when a send fails and the message is claimed again once its lease ends', () => {
    const leaseMs = 200
    const persistence = new InMemoryPersistence()
    const sendTimes: number[] = []
    let delivered = 0
    let remaining: OutgoingMessage[]

    beforeAll(async () => {
      persistence.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object
      } as unknown as Parameters<InMemoryPersistence['prepare']>[0])
      await persistence.storeOutgoingMessages([
        { ...outgoingMessage('retried'), attempts: undefined }
      ])
      sut = new OutgoingMessageDispatcher(
        persistence,
        async () => {
          sendTimes.push(Date.now())
          if (sendTimes.length === 1) {
            throw new Error('transport is down')
          }
          delivered++
        },
        Mock.ofType<Logger>().object,
        {
          ...DEFAULT_OUTGOING_MESSAGE_DISPATCHER_OPTIONS,
          pollIntervalMs: 20,
          leaseMs,
          sendTimeoutMs: 50
        }
      )
      sut.start()
      await until(() => delivered === 1)
      await sleep(100)
      await sut.stop()
      remaining = await persistence.claimDueOutgoingMessages(
        10,
        1,
        new Date(8_640_000_000_000_000)
      )
    })

    it('should send it again once its lease ends', () => {
      expect(sendTimes).toHaveLength(2)
      expect(sendTimes[1] - sendTimes[0]).toBeGreaterThanOrEqual(leaseMs - 5)
    })

    it('should deliver it once', () => {
      expect(delivered).toEqual(1)
    })

    it('should delete it once it is sent', () => {
      expect(remaining).toEqual([])
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
