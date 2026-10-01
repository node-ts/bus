import { Message, registerMessageTypes } from '@node-ts/bus-messages'
import { DefaultHandlerRegistry } from '../handler'
import { randomWords, resetMessageTypes } from '../test'
import { ClassConstructor } from '../util'
import { JsonSerializer } from './json-serializer'
import { MessageSerializer } from './message-serializer'
import { Serializer } from './serializer'

class DummyMessage {
  $name = 'bluh'
  $version = 1
  value: string

  constructor(s: string) {
    this.value = s
  }
}

class ToxicSerializer implements Serializer {
  serialize<ObjectType extends object>(obj: ObjectType): string {
    return (obj as Message).$name
  }

  deserialize<ObjectType extends object>(
    serialized: string,
    classType: ClassConstructor<ObjectType>
  ): ObjectType {
    return new classType(serialized)
  }

  toPlain<T extends object>(_: T): object {
    return {}
  }

  toClass<T extends object>(_: object, __: ClassConstructor<T>): T {
    return {} as T
  }
}

describe('MessageSerializer', () => {
  const serializer = new ToxicSerializer()
  const messageSerializer = new MessageSerializer(
    serializer,
    new DefaultHandlerRegistry()
  )

  it('should use underlying serializer to serialize', () => {
    const message = new DummyMessage('a')
    const result = messageSerializer.serialize(message)
    expect(result).toBe(message.$name)
  })

  it('should use underlying deserializer to deserialize', () => {
    const msg = new DummyMessage(randomWords())
    const raw = JSON.stringify(msg)

    const result = messageSerializer.deserialize<DummyMessage>(raw)
    expect(result.value).toBe(msg.value)
  })

  describe('when deserializing a message with registered message types but no handler', () => {
    const UNHANDLED_NAME = '@node-ts/bus-core/test-unhandled-registered'
    const payload = JSON.stringify({
      $name: UNHANDLED_NAME,
      $version: 0,
      at: '2020-01-01T00:00:00.000Z'
    })

    beforeAll(() => {
      resetMessageTypes()
      registerMessageTypes({
        messages: { [UNHANDLED_NAME]: 'Unhandled' },
        types: { Unhandled: { fields: { at: 'Date' } } }
      })
    })

    afterAll(() => resetMessageTypes())

    describe('with the default serializer', () => {
      let result: { at: unknown }

      beforeAll(() => {
        const sut = new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry()
        )
        result = sut.deserialize<Message & { at: unknown }>(payload)
      })

      it('should restore it as a plain object', () => {
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
        expect(result.at).toEqual(new Date('2020-01-01T00:00:00.000Z'))
      })
    })

    describe('with a custom serializer', () => {
      let result: { at: unknown }

      beforeAll(() => {
        const sut = new MessageSerializer(
          new ToxicSerializer(),
          new DefaultHandlerRegistry()
        )
        result = sut.deserialize<Message & { at: unknown }>(payload)
      })

      it('should parse it without the custom serializer, as for any message without a handler', () => {
        expect(result).toEqual(JSON.parse(payload))
      })
    })
  })
})
