import { TransportMessage } from '../transport'
import { messageHandlingContext } from './message-handling-context'

const buildTransportMessage = (): TransportMessage<unknown> => ({
  id: 'a',
  raw: {},
  attributes: { attributes: {}, stickyAttributes: {} },
  domainMessage: { $name: 'a', $version: 1 }
})

describe('messageHandlingContext', () => {
  describe('when a message is added', () => {
    it('should default to not being in a handler context', async () => {
      const message = buildTransportMessage()
      await messageHandlingContext.run(message, () => {
        expect(messageHandlingContext.isInHandlerContext).toEqual(false)
      })
    })

    it('should override being in a handler context', async () => {
      const message = buildTransportMessage()
      await messageHandlingContext.run(
        message,
        () => {
          expect(messageHandlingContext.isInHandlerContext).toEqual(true)
        },
        true
      )
    })

    it('should retrieve the message from within the same context', async () => {
      const message = buildTransportMessage()
      await messageHandlingContext.run(message, () => {
        const retrievedMessage = messageHandlingContext.get()
        expect(retrievedMessage).toEqual(message)
      })
    })

    it('should not retrieve a message from a different context', async () => {
      const message1 = buildTransportMessage()
      const context1 = messageHandlingContext.run(message1, async () => {
        const retrievedMessage = messageHandlingContext.get()!
        expect(retrievedMessage).toEqual(message1)
      })
      const message2 = buildTransportMessage()
      const context2 = messageHandlingContext.run(message2, async () => {
        const retrievedMessage = messageHandlingContext.get()!
        expect(retrievedMessage).toEqual(message2)
      })
      await Promise.all([context1, context2])
    })

    it('should retrieve a message from a nested async chain', async () => {
      const message = buildTransportMessage()
      await messageHandlingContext.run(message, async () => {
        await new Promise<void>(resolve => {
          const retrievedMessage = messageHandlingContext.get()!
          expect(retrievedMessage).toEqual(message)
          resolve()
        })
      })
    })
  })
})
