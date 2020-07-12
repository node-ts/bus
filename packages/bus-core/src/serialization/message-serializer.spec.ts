// tslint:disable:max-classes-per-file no-inferred-empty-object-type
import { Serializer } from './serializer'
import { ClassConstructor } from '../util'
import { MessageSerializer } from './message-serializer'
import { Mock, IMock, It } from 'typemoq'
import { HandlerRegistry } from '../handler'
import * as faker from 'faker'
import { Message } from '@node-ts/bus-messages'

class DummyMessage {
  $name = 'bluh'
  $version = 1
  value: string

  constructor (s: string) {
    this.value = s
  }
}

class ToxicSerializer implements Serializer {

  serialize<MessageType extends Message> (message: MessageType): string {
    return message.$name
  }

  deserialize<MessageType extends Message> (message: string, classType: ClassConstructor<MessageType>): MessageType {
    return new classType(message)
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

  it('should use underlying serializer to serialize', () => {
    const message: Message = {
      $name: msgName,
      $version: 1
    }
    const result = sut.serialize(message)
    expect(result).toBe(message.$name)
  })

  it('should use underlying deserializer to deserialize', () => {
    const msg = {
      $name: msgName,
      text: faker.random.words()
    }
    const raw = JSON.stringify(msg)

    const result = sut.deserialize<DummyMessage>(raw)

    handlerRegistry.verifyAll()
    expect(result.value).toBe(raw)
  })
})
