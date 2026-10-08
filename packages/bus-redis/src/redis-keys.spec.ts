import { InvalidRedisKeyName } from './error'
import { escapeGlob, isValidKeyName, RedisKeys } from './redis-keys'

describe('RedisKeys', () => {
  describe('when naming the keys of a queue', () => {
    const sut = new RedisKeys('bus')

    it('should put the queue name in a hash tag', () => {
      expect([
        sut.queue('orders'),
        sut.delayed('orders'),
        sut.deadLetter('orders')
      ]).toEqual([
        'bus:{orders}:queue',
        'bus:{orders}:delayed',
        'bus:{orders}:dead-letter'
      ])
    })

    it('should name the subscription set of a message', () => {
      expect(sut.subscriptions('@app/order-placed')).toEqual(
        'bus:subscriptions:@app/order-placed'
      )
    })
  })

  describe('when constructed with a prefix that has braces', () => {
    it('should throw InvalidRedisKeyName', () => {
      expect(() => new RedisKeys('bus{')).toThrow(InvalidRedisKeyName)
    })
  })

  describe('when checking a name', () => {
    it('should only accept non-empty names without braces', () => {
      expect(['orders', '', 'a{b', 'a}b'].map(isValidKeyName)).toEqual([
        true,
        false,
        false,
        false
      ])
    })
  })

  describe('when escaping a glob', () => {
    it('should escape the characters a Redis glob treats as special', () => {
      expect(escapeGlob('a*b?c[d]e\\f')).toEqual('a\\*b\\?c\\[d\\]e\\\\f')
    })
  })
})
