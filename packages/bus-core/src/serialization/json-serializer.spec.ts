import { MessageTypes } from '@node-ts/bus-messages'
import { MessageTypeReferenceNotFound } from './error'
import { JsonSerializer } from './json-serializer'

class Point {
  x: number
  at: Date

  get label(): string {
    return `${this.x}`
  }
}

class Shape {
  $name = 'shape'
  createdAt: Date
  origin: Point
  points: Point[]
  stamps: Date[]
  byName: Map<string, Point>
  counts: Map<number, number>
  tags: Set<string>
  big: bigint
  lookup: { [key: string]: Date }
  meta: { seenAt: Date }
  note?: string
  nothing: Point | null
  constructed: boolean

  constructor() {
    this.constructed = true
  }

  area(): number {
    return this.points.length
  }
}

const messageTypes: MessageTypes = {
  messages: { shape: 'Shape' },
  types: {
    Shape: {
      class: Shape,
      fields: {
        createdAt: 'Date',
        origin: { type: 'Point' },
        points: { array: { type: 'Point' } },
        stamps: { array: 'Date' },
        byName: { map: { type: 'Point' } },
        counts: { map: 'plain', keys: 'number' },
        tags: { set: 'plain' },
        big: 'BigInt',
        lookup: { record: 'Date' },
        meta: { type: 'Shape.meta' },
        nothing: { type: 'Point' }
      }
    },
    'Shape.meta': { fields: { seenAt: 'Date' } },
    Point: { class: Point, fields: { at: 'Date' } }
  }
}

const createPoint = (x: number): Point =>
  Object.assign(Object.create(Point.prototype) as Point, {
    x,
    at: new Date(x * 1000)
  })

const createShape = (): Shape => {
  const shape = new Shape()
  shape.createdAt = new Date('2020-01-01T00:00:00.000Z')
  shape.origin = createPoint(1)
  shape.points = [createPoint(2), createPoint(3)]
  shape.stamps = [new Date(5)]
  shape.byName = new Map([['a', createPoint(4)]])
  shape.counts = new Map([[7, 8]])
  shape.tags = new Set(['t'])
  shape.big = 2n ** 70n
  shape.lookup = { k: new Date(9) }
  shape.meta = { seenAt: new Date(10) }
  shape.nothing = null
  return shape
}

describe('JsonSerializer', () => {
  let sut: JsonSerializer

  describe('when serializing', () => {
    let result: string

    beforeAll(() => {
      sut = new JsonSerializer()
      result = sut.serialize(createShape())
    })

    it('should write plain JSON with no type information', () => {
      expect(JSON.parse(result)).toEqual({
        $name: 'shape',
        createdAt: '2020-01-01T00:00:00.000Z',
        origin: { x: 1, at: '1970-01-01T00:00:01.000Z' },
        points: [
          { x: 2, at: '1970-01-01T00:00:02.000Z' },
          { x: 3, at: '1970-01-01T00:00:03.000Z' }
        ],
        stamps: ['1970-01-01T00:00:00.005Z'],
        byName: { a: { x: 4, at: '1970-01-01T00:00:04.000Z' } },
        counts: { 7: 8 },
        tags: ['t'],
        big: '1180591620717411303424',
        lookup: { k: '1970-01-01T00:00:00.009Z' },
        meta: { seenAt: '1970-01-01T00:00:00.010Z' },
        nothing: null,
        constructed: true
      })
    })
  })

  describe('when deserializing', () => {
    describe('with message types', () => {
      let result: Shape

      beforeAll(() => {
        sut = new JsonSerializer(messageTypes)
        const serialized = JSON.parse(sut.serialize(createShape())) as object
        delete (serialized as Partial<Shape>).constructed
        result = sut.deserialize(JSON.stringify(serialized), Shape)
      })

      it('should create the top-level object from its class without running the constructor', () => {
        expect(result).toBeInstanceOf(Shape)
        expect(result.area()).toEqual(2)
        expect(result.constructed).toBeUndefined()
      })

      it('should restore Dates', () => {
        expect(result.createdAt).toEqual(new Date('2020-01-01T00:00:00.000Z'))
        expect(result.stamps).toEqual([new Date(5)])
      })

      it('should restore nested class instances and arrays of them', () => {
        expect(result.origin).toBeInstanceOf(Point)
        expect(result.origin.at).toEqual(new Date(1000))
        expect(result.origin.label).toEqual('1')
        result.points.forEach(point => expect(point).toBeInstanceOf(Point))
      })

      it('should restore Maps, Sets and bigints', () => {
        expect(result.byName).toBeInstanceOf(Map)
        expect(result.byName.get('a')).toBeInstanceOf(Point)
        expect(result.counts).toEqual(new Map([[7, 8]]))
        expect(result.tags).toEqual(new Set(['t']))
        expect(result.big).toEqual(2n ** 70n)
      })

      it('should restore records and object types', () => {
        expect(result.lookup.k).toEqual(new Date(9))
        expect(Object.getPrototypeOf(result.meta)).toBe(Object.prototype)
        expect(result.meta.seenAt).toEqual(new Date(10))
      })

      it('should leave null and missing fields alone', () => {
        expect(result.nothing).toBeNull()
        expect('note' in result).toEqual(false)
      })
    })

    describe('without message types', () => {
      let result: Shape

      beforeAll(() => {
        sut = new JsonSerializer()
        result = sut.deserialize(sut.serialize(createShape()), Shape)
      })

      it('should create the top-level object from its class', () => {
        expect(result).toBeInstanceOf(Shape)
        expect(result.area()).toEqual(2)
      })

      it('should leave nested values as JSON parsed them', () => {
        expect(result.createdAt).toEqual('2020-01-01T00:00:00.000Z')
        expect(result.origin).not.toBeInstanceOf(Point)
      })
    })

    describe('with a __proto__ key in the payload', () => {
      let result: Shape

      beforeAll(() => {
        sut = new JsonSerializer(messageTypes)
        result = sut.deserialize('{"$name":"shape","__proto__":{"x":1}}', Shape)
      })

      it('should keep the class prototype', () => {
        expect(Object.getPrototypeOf(result)).toBe(Shape.prototype)
      })
    })
  })

  describe('when converting to and from plain objects', () => {
    let plain: object
    let result: Shape

    beforeAll(() => {
      sut = new JsonSerializer(messageTypes)
      plain = sut.toPlain(createShape())
      result = sut.toClass(plain, Shape)
    })

    it('should convert to plain JSON values', () => {
      expect((plain as { createdAt: unknown }).createdAt).toEqual(
        '2020-01-01T00:00:00.000Z'
      )
    })

    it('should restore the types', () => {
      expect(result).toBeInstanceOf(Shape)
      expect(result.origin).toBeInstanceOf(Point)
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('when converting a plain object that already holds Dates', () => {
    const createdAt = new Date(1)
    let result: Shape

    beforeAll(() => {
      sut = new JsonSerializer(messageTypes)
      result = sut.toClass({ $name: 'shape', createdAt }, Shape)
    })

    it('should keep the Date', () => {
      expect(result.createdAt).toBe(createdAt)
    })
  })

  describe('when message types refer to a type they do not define', () => {
    it('should throw MessageTypeReferenceNotFound', () => {
      expect(
        () =>
          new JsonSerializer({
            messages: {},
            types: { A: { fields: { b: { array: { type: 'B' } } } } }
          })
      ).toThrow(MessageTypeReferenceNotFound)
    })
  })
})
