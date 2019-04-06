// tslint:disable:no-magic-numbers Date based tests

import { JsonSerializer } from './json-serializer'
import { Type } from 'class-transformer'

class Contract {
  @Type(() => Date) readonly c: Date

  testFn: () => void

  constructor (
    readonly a: string,
    readonly b: number,
    c: Date
  ) {
    this.c = c
  }
}

describe('JsonSerializer', () => {
  let sut: JsonSerializer
  const contract = new Contract('a', 1, new Date())

  beforeEach(() => {
    sut = new JsonSerializer()
  })

  describe('when serializing', () => {
    let result: string
    beforeEach(() => {
      result = sut.serialize({
        a: 'a',
        b: 1,
        c: new Date(2000, 2, 1)
      })
    })

    it('should convert an object to a string', () => {
      expect(result).toEqual('{"a":"a","b":1,"c":"2000-02-29T14:00:00.000Z"}')
    })
  })

  describe('when deserializing', () => {
    let result: Contract
    beforeEach(() => {
      result = sut.deserialize('{"a":"a","b":1,"c":"2000-02-29T14:00:00.000Z"}', Contract)
    })

    it('should deserialize to a plain object', () => {
      expect(result).toMatchObject({ a: 'a', b: 1 })
      expect(result.c).toBeDefined()
      // tslint:disable-next-line:no-unbound-method Testing presence
      expect(result.c.toUTCString).toBeDefined()
      expect(result.c.getDate()).toEqual(new Date(2000, 2, 1).getDate())
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
})
