import { MessageAttributeMap, MessageAttributes } from '@node-ts/bus-messages'
import type { SQSMessageAttributes, SQSRecord } from 'aws-lambda'

export const fromMessageAttributeMap = (
  sqsAttributes: SQSRecord['messageAttributes']
): MessageAttributes => {
  const messageOptions: MessageAttributes = {
    attributes: {},
    stickyAttributes: {}
  }

  messageOptions.correlationId = sqsAttributes.correlationId
    ? sqsAttributes.correlationId.stringValue
    : undefined

  const attributes: MessageAttributeMap = {}
  const stickyAttributes: MessageAttributeMap = {}

  Object.keys(sqsAttributes).forEach(key => {
    let cleansedKey: string | undefined
    if (key.startsWith('attributes.')) {
      cleansedKey = key.substring('attributes.'.length)
      attributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
    } else if (key.startsWith('stickyAttributes.')) {
      cleansedKey = key.substring('stickyAttributes.'.length)
      stickyAttributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
    }
  })

  messageOptions.attributes = Object.keys(attributes).length ? attributes : {}
  messageOptions.stickyAttributes = Object.keys(stickyAttributes).length
    ? stickyAttributes
    : {}

  return messageOptions
}

const getAttributeValue = (
  attributes: SQSMessageAttributes,
  key: string
): string | number | boolean => {
  const attribute = attributes[key]
  const value =
    attribute.dataType === 'Number'
      ? Number(attribute.stringValue)
      : attribute.dataType === 'Boolean'
      ? attribute.stringValue === 'true'
      : attribute.stringValue!
  return value
}
