// tslint:disable:max-classes-per-file no-inferred-empty-object-type
import { Serializer } from './serializer'
import { ClassConstructor } from '../util'
import { MessageSerializer } from './message-serializer';
import { Mock, IMock, It } from 'typemoq'
import { HandlerRegistry } from '../handler'
import * as faker from 'faker'

class DummyMessage {
  $name = 'bluh'
  $version = 1
  value: string

  constructor (s: string) {
    this.value = s
  }
}

class ToxicSerializer implements Serializer {

  serialize (msg: any): string {
    return msg.$name as string
  }

  deserialize<T extends object> (msg: string, classType: ClassConstructor<T>): T {
    return new classType(msg)
  }
}

describe('MessageSerializer', () => {

  let sut: MessageSerializer
  let handlerRegistry: IMock<HandlerRegistry>
  const msgName = 'dummy-message'

  beforeEach(() => {
    handlerRegistry = Mock.ofType<HandlerRegistry>()
    handlerRegistry.setup(h => h.getMessageType(
      It.isObjectWith({
        $name: msgName
      })
    )).returns(() => DummyMessage)

    const toxicSerializer = new ToxicSerializer()

    sut = new MessageSerializer(
      toxicSerializer,
      handlerRegistry.object
    )
  })

  it ('should use underlying serializer to serialize', () => {
    const msg = {
      $name: msgName
    }
    const result = sut.serialize(msg)
    // As per toxic serializer's behavior
    expect(result).toBe(msg.$name)
  })

  it ('should use underlying deserializer to deserialize', () => {
    const msg = {
      $name: msgName,
      text: faker.random.words()
    }
    const raw = JSON.stringify(msg)

    const result = sut.deserialize(raw) as DummyMessage

    handlerRegistry.verifyAll()

    // As per toxic serializer's behavior
    expect(result.value).toBe(raw)
  })
})
