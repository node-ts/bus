import {
  Bus,
  ClassConstructor,
  JsonSerializer,
  Serializer
} from '@node-ts/bus-core'
import { MessageTypes } from '@node-ts/bus-messages'
import { messageTypes } from './message-types.generated'
import { CreditCardCharged } from './messages'

// #region problem
const charged = new CreditCardCharged('tok_visa', 1200, new Date())
const received = JSON.parse(JSON.stringify(charged))

// Without message types, `chargedAt` is a string and `received` isn't a CreditCardCharged
console.log(typeof received.chargedAt) // 'string'
// #endregion problem

// #region message-types
const bus = Bus.configure()
  // Restores the Dates, Maps, Sets, bigints and classes in received messages
  .withMessageTypes(messageTypes)
  .build()
// #endregion message-types

// #region custom
/**
 * Writes messages as JSON, like the default serializer. A starting point for
 * a serializer that, say, encrypts some fields.
 */
export class CustomSerializer implements Serializer {
  private readonly json = new JsonSerializer()

  serialize<T extends object>(obj: T): string {
    return this.json.serialize(obj)
  }

  deserialize<T extends object>(
    val: string,
    classType: ClassConstructor<T>,
    // The message types of the bus that's reading the message
    messageTypes?: MessageTypes
  ): T {
    return this.json.deserialize(val, classType, messageTypes)
  }

  toPlain<T extends object>(obj: T): object {
    return this.json.toPlain(obj)
  }

  toClass<T extends object>(
    obj: object,
    classConstructor: ClassConstructor<T>,
    messageTypes?: MessageTypes
  ): T {
    return this.json.toClass(obj, classConstructor, messageTypes)
  }
}

Bus.configure()
  .withMessageTypes(messageTypes)
  .withSerializer(new CustomSerializer())
// #endregion custom

await bus.initialize()
