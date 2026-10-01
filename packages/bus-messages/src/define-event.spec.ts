import { defineEvent } from './define-event'
import { Event } from './event'
import { MessageOf } from './message-declaration'

const OrderPlaced = defineEvent('test/order-placed', { version: 1 })<{
  orderId: string
}>()
type OrderPlaced = MessageOf<typeof OrderPlaced>

describe('defineEvent', () => {
  describe('when creating an event', () => {
    let sut: OrderPlaced

    beforeAll(() => {
      sut = OrderPlaced({ orderId: '1' })
    })

    it('should copy its fields and add $name and $version', () => {
      expect(sut).toEqual({
        orderId: '1',
        $name: 'test/order-placed',
        $version: 1
      })
    })

    it('should be an event', () => {
      const event: Event = sut
      expect(event.$name).toEqual(OrderPlaced.NAME)
    })
  })
})
