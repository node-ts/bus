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
    it('should retrieve the message from within the same context', () => {
      const message = buildTransportMessage()
      messageHandlingContext.run(message, () => {
        const retrievedMessage = messageHandlingContext.get()
        expect(retrievedMessage).toEqual(message)
      })
    })

    it('should not retrieve a message from a different context', async () => {
      const context1 = new Promise<void>(resolve => {
        const message = buildTransportMessage()
        messageHandlingContext.run(message, async () => {
          const retrievedMessage = messageHandlingContext.get()!
          expect(retrievedMessage).toEqual(message)
          resolve()
        })
      })
      const context2 = new Promise<void>(resolve => {
        const message = buildTransportMessage()
        messageHandlingContext.run(message, async () => {
          const retrievedMessage = messageHandlingContext.get()!
          expect(retrievedMessage).toEqual(message)
          resolve()
        })
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
