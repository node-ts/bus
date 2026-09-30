import { Message } from '@node-ts/bus-messages'
import * as faker from 'faker'
import { DefaultHandlerRegistry } from '../handler'
import { ClassConstructor } from '../util'
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
    const msg = new DummyMessage(faker.random.words())
    const raw = JSON.stringify(msg)

    const result = messageSerializer.deserialize<DummyMessage>(raw)
    expect(result.value).toBe(msg.value)
  })
})
