import { toMessageAttributeMap } from './sqs-transport'
import { SNS } from 'aws-sdk'
import { MessageAttributes } from '@node-ts/bus-core'
import * as faker from 'faker'

describe('sqs-transport', () => {
  describe('when converting message attributes to SNS attribute values', () => {
    const messageOptions: MessageAttributes = {
      correlationId: faker.random.uuid(),
      attributes: {
        attribute1: 'a',
        attribute2: 1
      },
      stickyAttributes: {
        attribute1: 'b',
        attribute2: 2
      }
    }

    let messageAttributes: SNS.MessageAttributeMap

    beforeEach(() => {
      messageAttributes = toMessageAttributeMap(messageOptions)
    })

    it('should convert the correlationId', () => {
      expect(messageAttributes.correlationId).toBeDefined()
      expect(messageAttributes.correlationId.DataType).toEqual('String')
      expect(messageAttributes.correlationId.StringValue).toEqual(messageOptions.correlationId)
    })

    it('should convert attributesValues', () => {
      expect(messageAttributes['attributes.attribute1']).toBeDefined()
      const attribute1 = messageAttributes['attributes.attribute1']
      expect(attribute1.DataType).toEqual('String')
      expect(attribute1.StringValue).toEqual('a')

      expect(messageAttributes['attributes.attribute2']).toBeDefined()
      const attribute2 = messageAttributes['attributes.attribute2']
      expect(attribute2.DataType).toEqual('Number')
      expect(attribute2.StringValue).toEqual('1')
    })

    it('should convert stickyAttributeValues', () => {
      expect(messageAttributes['stickyAttributes.attribute1']).toBeDefined()
      const attribute1 = messageAttributes['stickyAttributes.attribute1']
      expect(attribute1.DataType).toEqual('String')
      expect(attribute1.StringValue).toEqual('b')

      expect(messageAttributes['stickyAttributes.attribute2']).toBeDefined()
      const attribute2 = messageAttributes['stickyAttributes.attribute2']
      expect(attribute2.DataType).toEqual('Number')
      expect(attribute2.StringValue).toEqual('2')
    })
  })
})
