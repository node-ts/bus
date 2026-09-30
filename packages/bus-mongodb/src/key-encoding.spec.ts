import { decodeKey, decodeKeys, encodeKey, encodeKeys } from './key-encoding'

const TRICKY_KEYS = [
  '$a',
  'a$b',
  'a.b',
  '%24',
  'a__b',
  '%',
  '$$',
  '%2E',
  '%25',
  '%%24.$',
  '..',
  'plain',
  ''
]

describe('keyEncoding', () => {
  describe('when encoding a single key', () => {
    describe.each(TRICKY_KEYS)('with the key %j', key => {
      let encoded: string
      let decoded: string

      beforeAll(() => {
        encoded = encodeKey(key)
        decoded = decodeKey(encoded)
      })

      it('should not contain characters mongodb rejects in field names', () => {
        expect(encoded).not.toMatch(/[$.]/)
      })

      it('should decode back to the original key', () => {
        expect(decoded).toEqual(key)
      })
    })
  })

  describe('when encoding every pair of tricky keys joined together', () => {
    let failures: string[]

    beforeAll(() => {
      const keys = TRICKY_KEYS.flatMap(a => TRICKY_KEYS.map(b => a + b))
      failures = keys.filter(key => decodeKey(encodeKey(key)) !== key)
    })

    it('should decode each back to the original key', () => {
      expect(failures).toEqual([])
    })
  })

  describe('when encoding a nested object', () => {
    const date = new Date()
    const value = {
      $workflowId: 'abc',
      'a.b': {
        $nested: { 'deep.$key': 1, '%24': [{ $inArray: true }, 'text', 2] }
      },
      a__b: null,
      $date: date
    }
    let encoded: typeof value
    let decoded: typeof value

    beforeAll(() => {
      encoded = encodeKeys(value)
      decoded = decodeKeys(encoded)
    })

    it('should encode nested keys, including keys of objects in arrays', () => {
      expect(encoded).toEqual({
        '%24workflowId': 'abc',
        'a%2Eb': {
          '%24nested': {
            'deep%2E%24key': 1,
            '%2524': [{ '%24inArray': true }, 'text', 2]
          }
        },
        a__b: null,
        '%24date': date
      })
    })

    it('should leave values that are not plain objects as-is', () => {
      expect((encoded as any)['%24date']).toBe(date)
    })

    it('should decode back to the original object', () => {
      expect(decoded).toEqual(value)
    })
  })
})
