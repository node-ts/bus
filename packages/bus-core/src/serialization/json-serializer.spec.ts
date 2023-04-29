// tslint:disable:no-magic-numbers Date based tests
import { JsonSerializer } from './json-serializer'

class Contract {
  readonly c: Date

  testFn: () => void

  constructor(readonly a: string, readonly b: number, c: Date) {
    this.c = c
  }
}

describe('JsonSerializer', () => {
  let sut: JsonSerializer
  const date = new Date(2000, 2, 1, 10, 0, 0, 0)
  const contract = new Contract('a', 1, date)

  beforeEach(() => {
    sut = new JsonSerializer()
  })

  describe('when serializing', () => {
    let result: string
    beforeEach(() => {
      result = sut.serialize({
        a: 'a',
        b: 1,
        c: date
      })
    })

    it('should convert an object to a string', () => {
      expect(result).toEqual(`{"a":"a","b":1,"c":"${date.toISOString()}"}`)
    })
  })

  describe('when deserializing', () => {
    let result: Contract
    const date = new Date(200)
    beforeEach(() => {
      result = sut.deserialize(
        `{"a":"a","b":1,"c":"${date.toISOString()}"}`,
        Contract
      )
    })

    it('should deserialize to a plain object', () => {
      expect(result).toMatchObject({ a: 'a', b: 1 })
      expect(result.c).toBeDefined()
    })

    it('should be unable to deserilize strong types', () => {
      expect(result.c.toUTCString).toBeUndefined()
    })
  })

  describe('when converting typed object to plain', () => {
    let result: object
    beforeEach(() => {
      result = sut.toPlain(contract)
    })

    it('should strip out additional fields', () => {
      expect(Object.keys(result)).not.toContain('testFn')
    })
  })

  describe('when converting plain object to typed', () => {
    let result: Contract
    beforeEach(() => {
      const plain = sut.toPlain(contract)
      result = sut.toClass(plain, Contract)
    })

    it('should strip out additional fields', () => {
      expect(result).toBeInstanceOf(Contract)
    })
  })
})
