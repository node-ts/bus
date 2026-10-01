import { Command } from './command'
import { defineCommand } from './define-command'
import { MessageDeclaration, MessageOf } from './message-declaration'

const PlaceOrder = defineCommand('test/place-order')<{
  orderId: string
  placedAt: Date
  note?: string
}>()
type PlaceOrder = MessageOf<typeof PlaceOrder>

const Ping = defineCommand('test/ping', { version: 3 })()

describe('defineCommand', () => {
  describe('when creating a command', () => {
    let sut: PlaceOrder
    const data = { orderId: '1', placedAt: new Date(1) }

    beforeAll(() => {
      sut = PlaceOrder(data)
    })

    it('should copy its fields and add $name and $version', () => {
      expect(sut).toEqual({
        orderId: '1',
        placedAt: new Date(1),
        $name: 'test/place-order',
        $version: 0
      })
      expect(sut).not.toBe(data)
    })

    it('should create a plain object', () => {
      expect(Object.getPrototypeOf(sut)).toBe(Object.prototype)
    })

    it('should be a command', () => {
      const command: Command = sut
      expect(command.$name).toEqual(PlaceOrder.NAME)
    })
  })

  describe('when creating a command without fields', () => {
    let sut: MessageOf<typeof Ping>

    beforeAll(() => {
      sut = Ping()
    })

    it('should use the given version', () => {
      expect(sut).toEqual({ $name: 'test/ping', $version: 3 })
    })
  })

  describe('when reading the definition', () => {
    it('should have the $name as its NAME', () => {
      const name: 'test/place-order' = PlaceOrder.NAME
      expect(name).toEqual('test/place-order')
    })

    it('should have no prototype, so the bus can tell it from a message class', () => {
      expect(PlaceOrder.prototype).toBeUndefined()
    })

    it('should be a message declaration', () => {
      const declaration: MessageDeclaration<PlaceOrder> = PlaceOrder
      expect(declaration.NAME).toEqual(PlaceOrder.NAME)
    })
  })

  describe('when the fields are wrong', () => {
    let sut: unknown[]

    beforeAll(() => {
      // The @ts-expect-error lines fail the type check if the fields were accepted
      sut = [
        // @ts-expect-error placedAt is required
        PlaceOrder({ orderId: '1' }),
        // @ts-expect-error orderId is a string
        PlaceOrder({ orderId: 1, placedAt: new Date() }),
        // @ts-expect-error a command with required fields needs them
        PlaceOrder()
      ]
    })

    it('should not type check, though the fields are not validated at runtime', () => {
      expect(sut).toEqual([
        { orderId: '1', $name: 'test/place-order', $version: 0 },
        {
          orderId: 1,
          placedAt: expect.any(Date),
          $name: 'test/place-order',
          $version: 0
        },
        { $name: 'test/place-order', $version: 0 }
      ])
    })
  })
})
