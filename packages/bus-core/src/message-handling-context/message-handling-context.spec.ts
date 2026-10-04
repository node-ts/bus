import { TransportMessage } from '../transport'
import { MessageHandlingContext } from './message-handling-context'

const buildTransportMessage = (): TransportMessage<unknown> => ({
  id: 'a',
  raw: {},
  attributes: { attributes: {}, stickyAttributes: {} },
  domainMessage: { $name: 'a', $version: 1 },
  failedAttempts: 0
})

describe('MessageHandlingContext', () => {
  const sut = new MessageHandlingContext()

  describe('when a message is added', () => {
    it('should default to not being in a handler context', async () => {
      const message = buildTransportMessage()
      await sut.run(message, () => {
        expect(sut.isInHandlerContext).toEqual(false)
      })
    })

    it('should override being in a handler context', async () => {
      const message = buildTransportMessage()
      await sut.run(
        message,
        () => {
          expect(sut.isInHandlerContext).toEqual(true)
        },
        true
      )
    })

    it('should retrieve the message from within the same context', async () => {
      const message = buildTransportMessage()
      await sut.run(message, () => {
        const retrievedMessage = sut.get()
        expect(retrievedMessage).toEqual(message)
      })
    })

    it('should not retrieve a message from a different context', async () => {
      const message1 = buildTransportMessage()
      const context1 = sut.run(message1, async () => {
        const retrievedMessage = sut.get()!
        expect(retrievedMessage).toEqual(message1)
      })
      const message2 = buildTransportMessage()
      const context2 = sut.run(message2, async () => {
        const retrievedMessage = sut.get()!
        expect(retrievedMessage).toEqual(message2)
      })
      await Promise.all([context1, context2])
    })

    it('should retrieve a message from a nested async chain', async () => {
      const message = buildTransportMessage()
      await sut.run(message, async () => {
        await new Promise<void>(resolve => {
          const retrievedMessage = sut.get()!
          expect(retrievedMessage).toEqual(message)
          resolve()
        })
      })
    })
  })

  describe('when another context has a message', () => {
    const other = new MessageHandlingContext()
    let messageSeenBySut: TransportMessage<unknown> | undefined =
      buildTransportMessage()
    let isInHandlerContext = true

    beforeAll(async () => {
      await other.run(
        buildTransportMessage(),
        () => {
          messageSeenBySut = sut.get()
          isInHandlerContext = sut.isInHandlerContext
        },
        true
      )
    })

    it('should not see the message', () => {
      expect(messageSeenBySut).toBeUndefined()
    })

    it('should not be in a handler context', () => {
      expect(isInHandlerContext).toEqual(false)
    })
  })

  describe('when a copy of the message runs in a nested context', () => {
    const received = buildTransportMessage()
    const copy = { ...received }
    let receivedInNestedContext: TransportMessage<unknown> | undefined
    let messageInNestedContext: TransportMessage<unknown> | undefined

    beforeAll(async () => {
      await sut.run(received, async () =>
        sut.run(copy, () => {
          receivedInNestedContext = sut.getReceived()
          messageInNestedContext = sut.get()
        })
      )
    })

    it('should give the copy as the message', () => {
      expect(messageInNestedContext).toBe(copy)
    })

    it('should keep the received message', () => {
      expect(receivedInNestedContext).toBe(received)
    })
  })

  describe('when a message is run with the message it was received as', () => {
    const received = buildTransportMessage()
    let receivedInContext: TransportMessage<unknown> | undefined

    beforeAll(async () => {
      const outer = buildTransportMessage()
      await sut.run(outer, async () =>
        sut.run(
          received,
          () => {
            receivedInContext = sut.getReceived()
          },
          false,
          received
        )
      )
    })

    it('should use the given received message', () => {
      expect(receivedInContext).toBe(received)
    })
  })

  describe('when outside of a message handling context', () => {
    it('should have no received message', () => {
      expect(sut.getReceived()).toBeUndefined()
    })
  })
})
