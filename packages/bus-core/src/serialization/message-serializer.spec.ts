// tslint:disable:max-classes-per-file no-inferred-empty-object-type
import { handlerRegistry } from '../handler/handler-registry'
import { Serializer, MessageSerializer, setSerializer } from './serializer'
import { ClassConstructor } from '../util'
import * as faker from 'faker'
import { Message } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler/handler'

class DummyMessage {
  $name = 'bluh'
  $version = 1
  value: string

  constructor (s: string) {
    this.value = s
  }
}

class ToxicSerializer implements Serializer {

  serialize<ObjectType extends object> (obj: ObjectType): string {
    return (obj as Message).$name
  }

  deserialize<ObjectType extends object> (serialized: string, classType: ClassConstructor<ObjectType>): ObjectType {
    return new classType(serialized)
  }

  toPlain<T extends object> (_: T): object {
    return {}
  }

  toClass<T extends object> (_: object, __: ClassConstructor<T>): T {
    return {} as T
  }
}

describe('MessageSerializer', () => {

  beforeEach(() => {
    const toxicSerializer = new ToxicSerializer()
    setSerializer(toxicSerializer)

    handlerRegistry.register(DummyMessage, (_: HandlerContext<DummyMessage>) => undefined)
  })

  it('should use underlying serializer to serialize', () => {
    const message = new DummyMessage('a')
    const result = MessageSerializer.serialize(message)
    expect(result).toBe(message.$name)
  })

  it('should use underlying deserializer to deserialize', () => {
    const msg = new DummyMessage(faker.random.words())
    const raw = JSON.stringify(msg)

    const result = MessageSerializer.deserialize<DummyMessage>(raw)

    expect(result.value).toBe(raw)
  })
})
