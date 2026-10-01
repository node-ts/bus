import { MessageAttributes, messageAttributes } from './message-attributes'

type TenantAttributes = MessageAttributes<{ tenantId: string }>

describe('messageAttributes', () => {
  describe('when called without input', () => {
    let sut: MessageAttributes

    beforeAll(() => {
      sut = messageAttributes()
    })

    it('should default attributes and stickyAttributes to empty objects', () => {
      expect(sut).toEqual({ attributes: {}, stickyAttributes: {} })
    })
  })

  describe('when called with some of the fields', () => {
    let sut: MessageAttributes<{ tenantId: string }, { workflowId: string }>

    beforeAll(() => {
      sut = messageAttributes({
        correlationId: 'correlation-id',
        stickyAttributes: { workflowId: 'workflow-id' },
        attributes: { tenantId: 'tenant-id' }
      })
    })

    it('should keep them', () => {
      expect(sut).toEqual({
        correlationId: 'correlation-id',
        attributes: { tenantId: 'tenant-id' },
        stickyAttributes: { workflowId: 'workflow-id' }
      })
    })

    it('should infer the attribute types from them', () => {
      const tenantId: string = sut.attributes.tenantId
      expect(tenantId).toEqual('tenant-id')
    })
  })

  describe('when an attribute type has required keys', () => {
    let sut: unknown[]

    beforeAll(() => {
      // The @ts-expect-error lines fail the type check if the missing attributes were accepted
      sut = [
        // @ts-expect-error tenantId is required, so attributes can't be defaulted
        messageAttributes<{ tenantId: string }>(),
        // @ts-expect-error tenantId is required, so attributes can't be left out
        messageAttributes<{ tenantId: string }>({ correlationId: 'a' })
      ]
      const withTenant: TenantAttributes = messageAttributes({
        attributes: { tenantId: 'a' }
      })
      sut.push(withTenant)
    })

    it('should only type check when the attributes are given', () => {
      expect(sut).toEqual([
        { attributes: {}, stickyAttributes: {} },
        { correlationId: 'a', attributes: {}, stickyAttributes: {} },
        { attributes: { tenantId: 'a' }, stickyAttributes: {} }
      ])
    })
  })
})
