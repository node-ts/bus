import {
  Bus,
  BusInstance,
  deadLetter,
  handlerFor,
  InMemoryMessage,
  InMemoryQueue,
  Logger,
  OutgoingMessage,
  Persistence,
  TransportMessage
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import {
  messageTypes,
  TestCommand,
  TestCustomer,
  TestGeoPoint,
  TestOrderLine,
  TestRoundTripCommand
} from './helpers'
import { createTestRoundTripCommand } from './message-round-trip-cases'

/**
 * Far enough ahead that a running bus never finds the suite's stored messages due, since it claims them at the
 * current time. The store tests claim at explicit times from here.
 */
const STORE_TEST_EPOCH = Date.parse('2900-01-01T00:00:00.000Z')

const LEASE_MS = 10_000

const MAX_LEASE_MS = 3 * LEASE_MS

/**
 * How long a test waits for scheduled messages to be sent
 */
const TIMEOUT_MS = 20_000

const at = (offsetMs: number): Date => new Date(STORE_TEST_EPOCH + offsetMs)

const createOutgoingMessage = (
  dueAt: Date,
  kind: OutgoingMessage['kind'] = 'send'
): OutgoingMessage => {
  const id = randomUUID()
  return {
    id,
    kind,
    message: {
      $name: TestCommand.NAME,
      $version: 1,
      value: 'scheduled',
      date: '2020-01-02T03:04:05.006Z',
      nested: { 'dotted.key': 1, $dollarKey: [{ '%percent': true }] }
    },
    attributes: {
      correlationId: randomUUID(),
      messageId: id,
      sentAt: '2026-01-01T00:00:00.000Z',
      attributes: { tenant: 'a', count: 2, flag: true },
      stickyAttributes: { workflowId: randomUUID() }
    },
    headers: { 'x-tenant': 'a', 'x-count': 3, 'x-flag': false },
    dueAt
  }
}

interface ReceivedRoundTrip {
  message: TestRoundTripCommand
  attributes: MessageAttributes
  transportMessage: TransportMessage<InMemoryMessage>
  receivedAt: number
}

/**
 * A suite that checks a persistence stores messages sent with `deliverAfter` or `deliverAt`: it calls
 * `storeOutgoingMessages`, `claimDueOutgoingMessages`, `deleteOutgoingMessages` and `releaseOutgoingMessages` directly, then schedules
 * messages through buses that use the persistence, and checks each arrives once, when it's due, with its attributes,
 * headers and nested types.
 *
 * The suite stores messages due in the year 2900, and deletes them as it goes. Give it a persistence on its own
 * database or schema, since a running bus that shares the store with it could send its scheduled messages.
 * @param persistence A fully configured persistence that's the subject under test. It's disposed when the suite's
 * buses are disposed, unless another bus that uses it is still running.
 */
export const scheduledMessageRoundTripTests = (
  persistence: Persistence
): void => {
  const events = new EventEmitter()
  const receivedCommandIds: string[] = []
  let bus: BusInstance

  const store = () => {
    const {
      storeOutgoingMessages,
      claimDueOutgoingMessages,
      deleteOutgoingMessages,
      releaseOutgoingMessages
    } = persistence
    if (
      !storeOutgoingMessages ||
      !claimDueOutgoingMessages ||
      !deleteOutgoingMessages ||
      !releaseOutgoingMessages
    ) {
      throw new Error(
        `${persistence.constructor.name} doesn't implement storeOutgoingMessages, claimDueOutgoingMessages, deleteOutgoingMessages and releaseOutgoingMessages`
      )
    }
    return {
      storeOutgoingMessages: storeOutgoingMessages.bind(persistence),
      claimDueOutgoingMessages: claimDueOutgoingMessages.bind(persistence),
      deleteOutgoingMessages: deleteOutgoingMessages.bind(persistence),
      releaseOutgoingMessages: releaseOutgoingMessages.bind(persistence)
    }
  }

  const claimAt = async (now: Date) =>
    store().claimDueOutgoingMessages(100, LEASE_MS, MAX_LEASE_MS, now)

  const configureBus = () =>
    Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(messageTypes)
      .withTransport(new InMemoryQueue({ receiveTimeoutMs: 100 }))
      .withRecoverability(() => deadLetter())
      .withPersistence(persistence)
      .withHandler(
        handlerFor(TestCommand, (_message, attributes) => {
          receivedCommandIds.push(attributes.messageId!)
          events.emit('command-received')
        })
      )

  describe('when messages are scheduled in the persistence', () => {
    beforeAll(async () => {
      bus = configureBus()
        .withMiddleware({
          outgoing: async (context, next) => {
            context.headers['x-scheduled'] = 'yes'
            await next()
          }
        })
        .withHandler(
          handlerFor(TestRoundTripCommand, (message, attributes) => {
            const received: ReceivedRoundTrip = {
              message,
              attributes,
              transportMessage:
                bus.getHandlingContext() as TransportMessage<InMemoryMessage>,
              receivedAt: Date.now()
            }
            events.emit('round-trip-received', received)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    describe('and a stored message is not yet due', () => {
      const outgoingMessage = createOutgoingMessage(at(1_000))
      let claimed: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        claimed = await claimAt(at(999))
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should not claim it', () => {
        expect(claimed.map(m => m.id)).not.toContain(outgoingMessage.id)
      })
    })

    describe('and a stored message is due', () => {
      const outgoingMessage = createOutgoingMessage(at(0), 'publish')
      let duplicateIds: string[]
      let claimed: OutgoingMessage | undefined

      beforeAll(async () => {
        duplicateIds = await store().storeOutgoingMessages([outgoingMessage])
        claimed = (await claimAt(at(0))).find(m => m.id === outgoingMessage.id)
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should report no duplicates when storing it', () => {
        expect(duplicateIds).toEqual([])
      })

      it('should claim it as it was stored, on its first attempt', () => {
        expect(claimed).toEqual({ ...outgoingMessage, attempts: 1 })
      })

      it('should return its due time as a Date', () => {
        expect(claimed!.dueAt).toBeInstanceOf(Date)
      })
    })

    describe('and a claimed message is claimed again while its lease holds', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedAgain: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await claimAt(at(0))
        claimedAgain = await claimAt(at(LEASE_MS - 1))
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should not claim it', () => {
        expect(claimedAgain.map(m => m.id)).not.toContain(outgoingMessage.id)
      })
    })

    describe('and a claimed message is claimed again after its lease ends', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedAgain: OutgoingMessage | undefined

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await claimAt(at(0))
        claimedAgain = (await claimAt(at(LEASE_MS))).find(
          m => m.id === outgoingMessage.id
        )
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should claim it again, counting the attempt', () => {
        expect(claimedAgain?.attempts).toEqual(2)
      })
    })

    describe('and a message is claimed for the second time', () => {
      // The second claim, at LEASE_MS, leases it for twice as long
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedBeforeLeaseEnds: OutgoingMessage[]
      let claimedAfterLeaseEnds: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await claimAt(at(0))
        await claimAt(at(LEASE_MS))
        claimedBeforeLeaseEnds = await claimAt(at(3 * LEASE_MS - 1))
        claimedAfterLeaseEnds = await claimAt(at(3 * LEASE_MS))
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should lease it for its lease times its attempts', () => {
        expect(claimedBeforeLeaseEnds.map(m => m.id)).not.toContain(
          outgoingMessage.id
        )
        expect(claimedAfterLeaseEnds.map(m => m.id)).toContain(
          outgoingMessage.id
        )
      })
    })

    describe('and a message keeps being claimed', () => {
      // Its fourth claim, at 6 leases, would lease it for 4 leases, but the lease is capped at MAX_LEASE_MS
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedBeforeCappedLeaseEnds: OutgoingMessage[]
      let claimedAfterCappedLeaseEnds: OutgoingMessage | undefined

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await claimAt(at(0))
        await claimAt(at(LEASE_MS))
        await claimAt(at(3 * LEASE_MS))
        await claimAt(at(6 * LEASE_MS))
        claimedBeforeCappedLeaseEnds = await claimAt(
          at(6 * LEASE_MS + MAX_LEASE_MS - 1)
        )
        claimedAfterCappedLeaseEnds = (
          await claimAt(at(6 * LEASE_MS + MAX_LEASE_MS))
        ).find(m => m.id === outgoingMessage.id)
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should lease it for no longer than the longest lease', () => {
        expect(claimedBeforeCappedLeaseEnds.map(m => m.id)).not.toContain(
          outgoingMessage.id
        )
        expect(claimedAfterCappedLeaseEnds?.attempts).toEqual(5)
      })
    })

    describe('and a message is stored with a lease', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedWhileLeased: OutgoingMessage[]
      let claimedAfterLease: OutgoingMessage | undefined

      beforeAll(async () => {
        await store().storeOutgoingMessages([
          { ...outgoingMessage, leaseUntil: at(LEASE_MS) }
        ])
        claimedWhileLeased = await claimAt(at(LEASE_MS - 1))
        claimedAfterLease = (await claimAt(at(LEASE_MS))).find(
          m => m.id === outgoingMessage.id
        )
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should not claim it until the lease ends', () => {
        expect(claimedWhileLeased.map(m => m.id)).not.toContain(
          outgoingMessage.id
        )
      })

      it('should claim it once the lease ends, without the lease', () => {
        expect(claimedAfterLease).toEqual({ ...outgoingMessage, attempts: 1 })
      })
    })

    describe('and a claimed message is released', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedAgain: OutgoingMessage | undefined

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await claimAt(at(0))
        await store().releaseOutgoingMessages([
          { id: outgoingMessage.id, attempts: 1 },
          { id: randomUUID(), attempts: 1 }
        ])
        claimedAgain = (await claimAt(at(0))).find(
          m => m.id === outgoingMessage.id
        )
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it('should be claimable straight away, as if it had not been claimed', () => {
        expect(claimedAgain?.attempts).toEqual(1)
      })
    })

    describe('and a message is released after another process claimed it again', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimedAfterStaleRelease: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        // The first claim's lease ends, and another process claims it
        await claimAt(at(0))
        await claimAt(at(LEASE_MS))
        // The first process releases it late, for its own claim
        await store().releaseOutgoingMessages([
          { id: outgoingMessage.id, attempts: 1 }
        ])
        claimedAfterStaleRelease = await claimAt(at(LEASE_MS))
      })

      afterAll(async () => store().deleteOutgoingMessages([outgoingMessage.id]))

      it("should leave the other process' claim alone", () => {
        expect(claimedAfterStaleRelease.map(m => m.id)).not.toContain(
          outgoingMessage.id
        )
      })
    })

    describe('and a stored message is deleted', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      let claimed: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        await store().deleteOutgoingMessages([outgoingMessage.id, randomUUID()])
        claimed = await claimAt(at(0))
      })

      it('should not claim it', () => {
        expect(claimed.map(m => m.id)).not.toContain(outgoingMessage.id)
      })
    })

    describe('and a message is stored twice', () => {
      const outgoingMessage = createOutgoingMessage(at(0))
      const other = createOutgoingMessage(at(0))
      let duplicateIds: string[]
      let claimed: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages([outgoingMessage])
        duplicateIds = await store().storeOutgoingMessages([
          other,
          { ...outgoingMessage, headers: { 'x-tenant': 'b' } }
        ])
        claimed = (await claimAt(at(0))).filter(
          m => m.id === outgoingMessage.id
        )
      })

      afterAll(async () =>
        store().deleteOutgoingMessages([outgoingMessage.id, other.id])
      )

      it('should report its id as a duplicate', () => {
        expect(duplicateIds).toEqual([outgoingMessage.id])
      })

      it('should keep the first one it stored', () => {
        expect(claimed).toHaveLength(1)
        expect(claimed[0].headers).toEqual(outgoingMessage.headers)
      })
    })

    describe('and more messages are due than the claim limit', () => {
      const outgoingMessages = [
        createOutgoingMessage(at(2)),
        createOutgoingMessage(at(0)),
        createOutgoingMessage(at(1))
      ]
      let claimed: OutgoingMessage[]

      beforeAll(async () => {
        await store().storeOutgoingMessages(outgoingMessages)
        claimed = await store().claimDueOutgoingMessages(
          2,
          LEASE_MS,
          MAX_LEASE_MS,
          at(10)
        )
      })

      afterAll(async () =>
        store().deleteOutgoingMessages(outgoingMessages.map(m => m.id))
      )

      it('should claim the earliest due up to the limit', () => {
        expect(claimed.map(m => m.id)).toEqual([
          outgoingMessages[1].id,
          outgoingMessages[2].id
        ])
      })
    })

    describe('and several claims run at once', () => {
      const outgoingMessages = Array.from({ length: 20 }, (_, i) =>
        createOutgoingMessage(at(i))
      )
      let claimedIds: string[]

      beforeAll(async () => {
        await store().storeOutgoingMessages(outgoingMessages)
        const claims = await Promise.all(
          [1, 2, 3, 4].map(async () =>
            store().claimDueOutgoingMessages(
              10,
              LEASE_MS,
              MAX_LEASE_MS,
              at(100)
            )
          )
        )
        const storedIds = new Set(outgoingMessages.map(m => m.id))
        claimedIds = claims
          .flat()
          .map(m => m.id)
          .filter(id => storedIds.has(id))
      })

      afterAll(async () =>
        store().deleteOutgoingMessages(outgoingMessages.map(m => m.id))
      )

      it('should claim each message once', () => {
        expect(claimedIds).toHaveLength(outgoingMessages.length)
        expect(new Set(claimedIds).size).toEqual(outgoingMessages.length)
      })
    })

    describe('and a message with nested types is sent with deliverAfter', () => {
      const deliverAfter = 1_000
      const sent = createTestRoundTripCommand()
      const correlationId = randomUUID()
      let sentAt: number
      let received: ReceivedRoundTrip

      beforeAll(async () => {
        const receivedEvent = once(events, 'round-trip-received')
        sentAt = Date.now()
        await bus.send(sent, {
          deliverAfter,
          correlationId,
          attributes: { attribute1: 'a' },
          stickyAttributes: { sticky1: 'b' }
        })
        ;[received] = (await receivedEvent) as [ReceivedRoundTrip]
      }, TIMEOUT_MS)

      it('should not deliver it before it is due', () => {
        expect(received.receivedAt).toBeGreaterThanOrEqual(
          sentAt + deliverAfter
        )
      })

      it('should keep its correlation id, attributes and sticky attributes', () => {
        expect(received.attributes).toMatchObject({
          correlationId,
          attributes: { attribute1: 'a' },
          stickyAttributes: { sticky1: 'b' }
        })
      })

      it('should keep the headers set by outgoing middleware', () => {
        expect(received.transportMessage.raw.headers).toEqual({
          'x-scheduled': 'yes'
        })
      })

      it('should restore its nested types', () => {
        const { message } = received
        expect(message).toBeInstanceOf(TestRoundTripCommand)
        expect(message.placedAt).toBeInstanceOf(Date)
        expect(message.placedAt.getTime()).toEqual(sent.placedAt.getTime())
        expect(message.customer).toBeInstanceOf(TestCustomer)
        expect(message.customer.address.location).toBeInstanceOf(TestGeoPoint)
        expect(message.lines[0]).toBeInstanceOf(TestOrderLine)
        expect(message.linesBySku).toBeInstanceOf(Map)
        expect(message.tags).toEqual(sent.tags)
      })
    })

    describe('and several buses that use the persistence are running', () => {
      const messageCount = 20
      let otherBuses: BusInstance[]
      let sentIds: string[]

      beforeAll(async () => {
        otherBuses = [configureBus().build(), configureBus().build()]
        for (const otherBus of otherBuses) {
          await otherBus.initialize()
          await otherBus.start()
        }

        receivedCommandIds.length = 0
        const allReceived = new Promise<void>(resolve => {
          const onReceived = () => {
            if (receivedCommandIds.length >= messageCount) {
              events.off('command-received', onReceived)
              resolve()
            }
          }
          events.on('command-received', onReceived)
        })
        sentIds = Array.from({ length: messageCount }, () => randomUUID())
        for (const messageId of sentIds) {
          await bus.send(new TestCommand('scheduled', new Date()), {
            deliverAfter: 500,
            messageId
          })
        }
        await allReceived
        // Give a duplicate time to arrive
        await new Promise(resolve => setTimeout(resolve, 1_500))
      }, TIMEOUT_MS)

      afterAll(async () => {
        for (const otherBus of otherBuses) {
          await otherBus.dispose()
        }
      })

      it('should send each message once', () => {
        expect([...receivedCommandIds].sort()).toEqual([...sentIds].sort())
      })
    })
  })
}
