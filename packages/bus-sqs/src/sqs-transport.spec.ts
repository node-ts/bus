import { toMessageAttributeMap, SqsMessageAttributes, fromMessageAttributeMap } from './sqs-transport'
import { SNS } from 'aws-sdk'
import { MessageAttributes } from '@node-ts/bus-core'
import * as faker from 'faker'

describe('sqs-transport', () => {
  describe('when converting SNS attribute values to message attributes', () => {
    const correlationId = faker.random.uuid()

    const sqsAttributes: SqsMessageAttributes = {
      'stickyAttributes.attribute1': { Type: 'String', Value: 'b' },
      'stickyAttributes.attribute2': { Type: 'Number', Value: '2' },
      correlationId: { Type: 'String', Value: correlationId },
      'attributes.attribute2': { Type: 'Number', Value: '1' },
      'attributes.attribute1': { Type: 'String', Value: 'a' }
    }

    let messageAttributes: MessageAttributes

    beforeEach(() => {
      messageAttributes = fromMessageAttributeMap(sqsAttributes)
    })

    it('should parse the correlation id', () => {
      expect(messageAttributes.correlationId).toEqual(correlationId)
    })

    it('should parse the attributes', () => {
      expect(messageAttributes.attributes).toMatchObject({
        attribute1: 'a',
        attribute2: 1
      })
    })

    it('should parse the sticky attributes', () => {
      expect(messageAttributes.stickyAttributes).toMatchObject({
        attribute1: 'b',
        attribute2: 2
      })
    })

  })

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
