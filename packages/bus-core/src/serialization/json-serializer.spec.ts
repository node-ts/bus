import { JsonSerializer } from './json-serializer'

describe('JsonSerializer', () => {
  let sut: JsonSerializer

  beforeEach(() => {
    sut = new JsonSerializer()
  })

  describe('when serializing', () => {
    let result: string
    beforeEach(() => {
      result = sut.serialize({
        string: 'a',
        number: 1
      })
    })

    it('should convert an object to a string', () => {
      expect(result).toEqual('{"string":"a","number":1}')
    })
  })

  describe('when deserializing', () => {
    class Contract {
      constructor (
        readonly a: string,
        readonly b: number
      ) {
      }
    }
    let result: Contract
    beforeEach(() => {
      result = sut.deserialize('{"a":"a","b":1}', Contract)
    })

    it('should deserialize to a plain object', () => {
      expect(result).toMatchObject({ a: 'a', b: 1 })
    })
  })
})
