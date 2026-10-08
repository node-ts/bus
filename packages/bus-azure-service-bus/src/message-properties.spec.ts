import { TransportHeaderReserved } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import {
  ApplicationProperties,
  toApplicationProperties,
  toFailedAttempts,
  toMessageAttributes
} from './message-properties'

describe('message-properties', () => {
  describe('when converting attributes and headers to application properties and back', () => {
    const messageAttributes: MessageAttributes = {
      correlationId: 'correlation-1',
      messageId: 'message-1',
      sentAt: '2026-10-08T00:00:00.000Z',
      replyTo: 'orders',
      attributes: { flag: true, off: false, zero: 0, name: 'x', empty: '' },
      stickyAttributes: { tenant: 'acme', missing: undefined }
    }
    let properties: ApplicationProperties
    let readBack: MessageAttributes

    beforeAll(() => {
      properties = toApplicationProperties(messageAttributes, {
        'x-tenant': 'acme'
      })
      readBack = toMessageAttributes({
        applicationProperties: properties,
        correlationId: messageAttributes.correlationId,
        replyTo: messageAttributes.replyTo
      })
    })

    it('should write each header under its own name', () => {
      expect(properties['x-tenant']).toEqual('acme')
    })

    it('should not write correlationId and replyTo, which are native fields', () => {
      expect(properties).not.toHaveProperty('correlationId')
      expect(properties).not.toHaveProperty('replyTo')
    })

    it('should leave out undefined values', () => {
      expect(properties).not.toHaveProperty('stickyAttributes.missing')
    })

    it('should read the attributes back with their values and types', () => {
      expect(readBack).toEqual({
        ...messageAttributes,
        stickyAttributes: { tenant: 'acme' }
      })
    })
  })

  describe('when a header has a name the transport writes itself', () => {
    it.each([
      'messageId',
      'sentAt',
      'failedAttempts',
      'bus-failure',
      'DeadLetterReason',
      'attributes.a',
      'stickyAttributes.b'
    ])('should throw TransportHeaderReserved for %s', name => {
      expect(() =>
        toApplicationProperties(
          { attributes: {}, stickyAttributes: {} },
          { [name]: 'x' }
        )
      ).toThrow(TransportHeaderReserved)
    })
  })

  describe('when reading failed attempts', () => {
    it('should be 0 for a message that has not been retried', () => {
      expect(toFailedAttempts({ applicationProperties: {} })).toEqual(0)
    })

    it('should read the failedAttempts property of a retry copy', () => {
      expect(
        toFailedAttempts({ applicationProperties: { failedAttempts: 3 } })
      ).toEqual(3)
    })
  })
})
