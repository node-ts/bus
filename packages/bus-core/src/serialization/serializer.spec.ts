import { JsonSerializer } from './json-serializer'
import { Serializer, setSerializer, getSerializer } from './serializer'

describe('Serializer', () => {
  beforeEach(() => setSerializer(undefined as any as Serializer))

  describe('when calling getSerializer before setSerializer', () => {
    it('should return the default serializer', () => {
      expect(getSerializer()).toBeInstanceOf(JsonSerializer)
    })
  })

  describe('when calling getSerializer after setSerializer', () => {
    it('should return the configured serializer', () => {
      setSerializer(new Date() as any as Serializer)
      expect(getSerializer()).toBeInstanceOf(Date)
    })
  })
})
